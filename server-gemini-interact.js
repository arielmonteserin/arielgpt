const fs = require("fs");
const levenshtein = require("fast-levenshtein");

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const { GoogleGenAI } = require("@google/genai");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.json());
app.use(cors());

// Agregar endpoint /ping para healthcheck
app.get('/ping', (req, res) => {
  res.status(200).send('pong');
  console.log("Ping recibido");
});

let tabletSocketId = null;

// Configuración del cliente con la API de Interactions
const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Estado por usuario: el historial lo gestiona el servidor via previous_interaction_id
// users[name] = { systemInstruction, lastInteractionId, contUserMessages }
const users = {};

let automatic_mode = "start";

let selfContext = "";
let context = "";
let modelGemini = "gemini-3.1-flash-lite";
let temperatureGemini = 1.0;
let thinkingLevelGemini = "minimal"; // minimal, low, medium, high
let thinkingSummaryGemini = "none"; // auto, none
let maxTokensGemini = 1024;
let contextData = "{}";

try {
  contextData = JSON.parse(fs.readFileSync("context.json", "utf8"));
  selfContext = contextData.self || "";
  context = contextData.context || "";
  unknownContext = contextData.unknown || "";
  console.log("Contexto cargado correctamente:", selfContext);
  console.log("ContextData:", contextData);
} catch (error) {
  console.error("Error al leer el archivo context.json:", error);
}

// Estado para los usuarios del modo automático
const autoModeUsers = {
  start: { systemInstruction: `${selfContext} ${context} ${contextData.userModeStart}`, lastInteractionId: null },
  cena:  { systemInstruction: `${selfContext} ${context} ${contextData.userModeCena}`,  lastInteractionId: null },
  baile: { systemInstruction: `${selfContext} ${context} ${contextData.userModeBaile}`, lastInteractionId: null }
};

/**
 * Genera una respuesta usando la API de Interactions de Gemini.
 * El historial de la conversación se gestiona en el servidor mediante
 * previous_interaction_id, eliminando la necesidad de mantenerlo en el cliente.
 *
 * @param {object} userState  - { systemInstruction, lastInteractionId }
 * @param {string} inputText  - Mensaje del usuario
 * @returns {{ text: string, interactionId: string }}
 */
async function generateBotResponse(userState, inputText) {
  console.log("Enviando al bot:", inputText);
  try {
    const params = {
      model: modelGemini,
      input: inputText,
      system_instruction: userState.systemInstruction,
      generation_config: {
        temperature: temperatureGemini,
        max_output_tokens: maxTokensGemini,
        thinking_level: thinkingLevelGemini,
        thinking_summaries: thinkingSummaryGemini
      }
    };

    if (userState.lastInteractionId) {
      params.previous_interaction_id = userState.lastInteractionId;
    }

    const interaction = await client.interactions.create(params);

    let text = interaction.output_text || "No se pudo generar una respuesta.";

    // Los modelos Gemma a veces envuelven la respuesta entre comillas
    // seguida de narración con asteriscos. Extraemos el texto posterior a la
    // última comilla doble.
    if (modelGemini.includes("gemma") && text.includes("*")) {
      const lastQuoteIndex = text.lastIndexOf('"');
      console.log("Respuesta Gemma antes de filtro:", text);
      if (lastQuoteIndex !== -1) {
        text = text.substring(lastQuoteIndex + 1).trim();
      }
    }

    console.log("Respuesta generada por Gemini:", text);
    return { text, interactionId: interaction.id };
  } catch (error) {
    console.error("Error al generar respuesta con Gemini:", error);
    return { text: "Lo siento, no puedo responder en este momento.", interactionId: userState.lastInteractionId };
  }
}

// Aplica un cambio de configuración basado en el mensaje recibido
function applyConfigurationChange(config, socket) {
  try {
    // Cambia la temperatura
    if (config.startsWith(process.env.CONFIG_TEMP)) {
      const newTemperature = parseFloat(config.substring(process.env.CONFIG_TEMP.length));
      if (!isNaN(newTemperature)) {
        temperatureGemini = newTemperature;
        console.log("Nueva temperatura configurada:", temperatureGemini);
        return "Nueva temperatura configurada:" + temperatureGemini;
      } else {
        return "Error: La temperatura no es un número válido.";
      }
    }

    // Cambia el modelo
    if (config.startsWith(process.env.CONFIG_SET_LLM)) {
      const newModel = config.substring(process.env.CONFIG_SET_LLM.length).trim();
      switch (newModel) {
        case "0": modelGemini = "gemini-3.1-flash-lite"; break;
        case "1": modelGemini = "gemini-3.5-flash"; break;
        case "2": modelGemini = "gemma-4-26b-a4b-it"; break;
        case "3": modelGemini = "gemma-4-31b-it"; break;
        case "4": modelGemini = "gemini-2.5-flash"; break;
        case "5": modelGemini = "gemini-2.5-flash-lite"; break;
        default: return "Modelo no válido";
      }
      console.log("Nuevo modelo configurado:", modelGemini);
      return "Nuevo modelo configurado:" + modelGemini;
    }

    // Cambia el modo
    if (config.startsWith(process.env.CONFIG_SET_MODE)) {
      const newMode = config.substring(process.env.CONFIG_SET_MODE.length).trim();
      if (newMode === "start" || newMode === "cena" || newMode === "baile") {
        automatic_mode = newMode;
        console.log("Nuevo modo configurado:", automatic_mode);
        return "Nuevo modo configurado:" + automatic_mode;
      } else {
        return "Modo no válido";
      }
    }

    // Resetea el usuario (borra su estado local; el servidor retiene su historial 55 días)
    if (config.startsWith(process.env.CONFIG_RESET_USER)) {
      const userName = config.substring(process.env.CONFIG_RESET_USER.length).trim();
      if (users[userName]) {
        delete users[userName];
        console.log("Usuario reseteado:", userName);
        return "Usuario reseteado:" + userName;
      } else {
        return "Error: Usuario no encontrado.";
      }
    }

    // Agrega un hecho al usuario (se incorpora al system instruction de la próxima conversación)
    if (config.startsWith(process.env.CONFIG_ADD_FACT)) {
      const userName = config.substring(process.env.CONFIG_ADD_FACT.length, config.indexOf("-")).trim();
      const fact = config.substring(config.indexOf("-") + 1).trim();
      if (users[userName]) {
        users[userName].systemInstruction += "\n" + fact;
        console.log("Hecho agregado al usuario:", userName, fact);
        return "Hecho agregado al usuario:" + userName + " " + fact;
      } else {
        if (contextData.hasOwnProperty(userName)) {
          contextData[userName] += " " + fact;
          console.log("Hecho agregado al usuario:", userName, fact);
          return "Hecho agregado al usuario:" + userName + " " + fact;
        }
        return "Error: Usuario no encontrado.";
      }
    }

    // Lista los usuarios actuales
    if (config.startsWith(process.env.CONFIG_LIST_USERS)) {
      const userList = Object.keys(users).map((userName) => {
        const u = users[userName];
        return `${userName}: ${u.contUserMessages} mensajes, interactionId: ${u.lastInteractionId || "ninguno"}`;
      }).join("\n");
      console.log("Lista de usuarios:", userList);
      return "Lista de usuarios:\n" + userList;
    }

    // Retorna la configuración actual
    if (config.startsWith(process.env.CONFIG_GET_CONF)) {
      const currentConfig = `
        Configuración actual:
        - Temperatura: ${temperatureGemini}
        - Modelo: ${modelGemini}
        - Max Tokens: ${maxTokensGemini}
        - Modo: ${automatic_mode}
      `;
      console.log("Configuración actual:", currentConfig);
      return "Configuración actual:\n" + currentConfig;
    }

    // Envía un mensaje directo a la tablet
    if (config.startsWith(process.env.CONFIG_DMSG)) {
      const message = config.substring(process.env.CONFIG_DMSG.length).trim();
      if (tabletSocketId) {
        io.to(tabletSocketId).emit("receive_message", { name: "ArielGPT", text: message });
        console.log("Mensaje enviado a la tablet:", message);
        return "Mensaje enviado a la tablet:" + message;
      } else {
        return "Error: Tablet no conectada.";
      }
    }

    // Retorna información del usuario (la API de Interactions gestiona el historial en el servidor)
    if (config.startsWith(process.env.CONFIG_GET_MSGS)) {
      const userName = config.substring(process.env.CONFIG_GET_MSGS.length).trim();
      if (users[userName]) {
        const u = users[userName];
        return `Usuario: ${userName}\nMensajes: ${u.contUserMessages}\nÚltimo interaction ID: ${u.lastInteractionId || "ninguno"}\nSystem instruction: ${u.systemInstruction}`;
      } else {
        return "Error: Usuario no encontrado.";
      }
    }

    // Habilita el envío de imágenes
    if (config.startsWith(process.env.CONFIG_ENABLE_IMG)) {
      socket.emit("enable_img");
      console.log("Imagen habilitada");
      return "Imagen habilitada";
    }

    return "Comando no reconocido.";
  } catch (error) {
    console.error("Error al aplicar la configuración:", error);
    return "Error al aplicar la configuración:" + error;
  }
}

let lastMessageReceivedAt = 0;

io.on("connection", (socket) => {
  console.log("Nuevo usuario conectado", socket.id);

  socket.on("tablet_connected", () => {
    tabletSocketId = socket.id;
    console.log("Tablet conectada con socket.id:", tabletSocketId);
  });

  socket.on("send_message", async (msg) => {
    let isUserWithContext = false;

    if (msg.name.startsWith("#")) {
      isUserWithContext = true;
      msg.name = msg.name.substring(1);
    }

    socket.emit("receive_message", msg);

    if (msg.text.startsWith(process.env.CONFIG_PREFIX)) {
      const config = msg.text.substring(process.env.CONFIG_PREFIX.length).trim();
      socket.emit("receive_message", { name: "ArielGPT", text: applyConfigurationChange(config, socket) });
    } else {
      if (tabletSocketId) {
        io.to(tabletSocketId).emit("receive_message", msg);
      }

      console.log("Nuevo mensaje de usuario:", socket.id, msg);
      lastMessageReceivedAt = Date.now();

      // Crear estado del usuario si es la primera vez
      if (!users[msg.name]) {
        let userContext = "unknown";
        if (isUserWithContext)
          userContext = getUserContextFromJson(msg.name);

        if (userContext === "unknown") {
          userContext = unknownContext + " Su nombre de usuario es " + msg.name + ".";
        }

        users[msg.name] = {
          systemInstruction: `${selfContext}\n${context}\n${userContext}`,
          lastInteractionId: null,
          contUserMessages: 0
        };
        console.log("Nuevo usuario creado:", msg.name);
      }

      const userState = users[msg.name];
      userState.contUserMessages++;

      try {
        const { text: botResponseText, interactionId } = await generateBotResponse(userState, msg.text);

        // Actualizar el interaction ID para encadenar el próximo turno
        userState.lastInteractionId = interactionId;

        const botResponse = { name: "ArielGPT", text: botResponseText };

        socket.emit("receive_message", botResponse);
        if (tabletSocketId) {
          io.to(tabletSocketId).emit("receive_message", botResponse);
        }
      } catch (error) {
        console.error("Error al generar respuesta de ArielGPT:", error);
      }
    }
  });

  socket.on("disconnect", () => {
    console.log("Usuario desconectado", socket.id);
    if (socket.id === tabletSocketId) {
      tabletSocketId = null;
      console.log("Tablet desconectada");
    }
  });

  socket.on("upload_img", (data) => {
    if (tabletSocketId) {
      io.to(tabletSocketId).emit("receive_message", {
        name: data.name.substring(1),
        text: " ",
        imgData: data.imgData
      });
      io.to(tabletSocketId).emit("receive_message", { name: "ArielGPT", text: "👆" });
    }
    console.log(`Imagen recibida de ${data.name}`);
  });

  socket.on("keepalive", () => {
    console.log("Keepalive recibido de la tablet:", socket.id, new Date().toISOString());
  });
});

function getUserContextFromJson(name) {
  try {
    if (contextData.hasOwnProperty(name)) {
      return contextData[name];
    }
    return "unknown";
  } catch (error) {
    console.error("Error al leer el archivo context.json:", error);
    return "Error al cargar el contexto del usuario.";
  }
}

async function generateBotAutomaticResponse() {
  const modeUser = autoModeUsers[automatic_mode];
  if (!modeUser) return "Modo desconocido.";
  const { text, interactionId } = await generateBotResponse(modeUser, "Continúa la conversación.");
  modeUser.lastInteractionId = interactionId;
  return text;
}

let timeInterval = 4 * 60 * 1000;

setInterval(async () => {
  if (Date.now() - lastMessageReceivedAt < timeInterval) {
    return;
  }
  try {
    if (tabletSocketId) {
      const botResponseText = await generateBotAutomaticResponse();
      const botResponse = { name: "ArielGPT", text: botResponseText };
      io.to(tabletSocketId).emit("clear");
      console.log("Enviando mensaje a la tablet:", botResponse);
      io.to(tabletSocketId).emit("receive_message", botResponse);
    }
  } catch (error) {
    console.error("Error al generar respuesta automatica segun modo de ArielGPT:", error);
  }
}, timeInterval);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Servidor WebSocket en puerto ${PORT}`));
