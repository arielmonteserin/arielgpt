const fs = require("fs");
const levenshtein = require("fast-levenshtein");

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const User = require("./User");

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

let messages = [];
let tabletSocketId = null;

// Configuración de Google Generative AI (Gemini)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const users = {};
const maxMessagesPerUser = 10;
const preserveLastMsg = 3;

let automatic_mode = "start";

let selfContext = "";
let context = "";
let modelGemini = "gemini-3.1-flash-lite"; //"gemini-2.0-flash";
let temperatureGemini = 1.0;
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

const userModeStart = new User("userModeStart", selfContext + " " + context, null);
userModeStart.addMessage("system", `${selfContext} ${context} ${contextData.userModeStart}`);
const userModeCena = new User("userModeStart", selfContext + " " + context, null);
userModeCena.addMessage("system", `${selfContext} ${context} ${contextData.userModeCena}`);
const userModeBaile = new User("userModeStart", selfContext + " " + context, null);
userModeBaile.addMessage("system", `${selfContext} ${context} ${contextData.userModeBaile}`);

/**
 * Convierte el historial de mensajes al formato que requiere Gemini:
 * - systemInstruction: concatenación de todos los mensajes con role "system"
 * - contents: mensajes con role "user" o "model" (Gemini usa "model" en lugar de "assistant")
 * El último mensaje debe ser siempre del role "user".
 */
function splitMessagesForGemini(allMessages) {
  const systemParts = [];
  const contents = [];

  for (const msg of allMessages) {
    if (msg.role === "system") {
      systemParts.push(msg.content);
    } else {
      contents.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }]
      });
    }
  }

  return {
    systemInstruction: systemParts.join("\n"),
    contents
  };
}

// Genera una respuesta usando Gemini
async function generateBotResponse(user) {
  console.log("Enviado al bot:", user.getMessages());
  const { systemInstruction, contents } = splitMessagesForGemini(user.getMessages());

  // El último elemento debe ser "user"; si es "model" Gemini devuelve error
  if (contents.length === 0 || contents[contents.length - 1].role !== "user") {
    return "No se pudo generar una respuesta.";
  }

  // Separar el último mensaje del historial previo
  // Gemini requiere que el historial empiece siempre con role "user"
  let history = contents.slice(0, -1);
  while (history.length > 0 && history[0].role !== "user") {
    history = history.slice(1);
  }
  const lastMessage = contents[contents.length - 1].parts[0].text;

  try {
    const model = genAI.getGenerativeModel({
      model: modelGemini,
      systemInstruction: systemInstruction,
      generationConfig: {
        temperature: temperatureGemini,
        maxOutputTokens: maxTokensGemini
      }
    });

    const chat = model.startChat({ history });
    const result = await chat.sendMessage(lastMessage);
    let text = result.response.text();
    // Los modelos Gemma a veces envuelven la respuesta del personaje entre comillas
    // seguida de narración con asteriscos. Si es un modelo Gemma y el texto contiene
    // asteriscos, extraemos solo el fragmento posterior a la última comilla doble.
    if (modelGemini.includes("gemma") && text.includes("*")) {
      const lastQuoteIndex = text.lastIndexOf('"');
      console.log("Respuesta generada por Gemini eliminada:", text);
      if (lastQuoteIndex !== -1) {
        text = text.substring(lastQuoteIndex + 1).trim();
      }
    }
    console.log("Respuesta generada por Gemini:", text);
    return text;
  } catch (error) {
    console.error("Error al generar respuesta con Gemini:", error);
    return "Lo siento, no puedo responder en este momento.";
  }
}

// Resume un conjunto de mensajes del usuario usando Gemini
async function generateBotSummary(user) {
  console.log("Enviado al bot para resumir:", user.getMessages());
  const allMessages = user.getMessages();
  const messagesToSummary = allMessages.slice(1, -preserveLastMsg);
  const { systemInstruction, contents } = splitMessagesForGemini(messagesToSummary);

  const summaryRequest = "Resume los mensajes anteriores. Haz foco en los hechos relevantes que comentó el usuario.";

  // Gemini requiere que el historial empiece siempre con role "user"
  let history = contents;
  while (history.length > 0 && history[0].role !== "user") {
    history = history.slice(1);
  }

  try {
    const model = genAI.getGenerativeModel({
      model: modelGemini,
      systemInstruction: systemInstruction,
      generationConfig: {
        temperature: temperatureGemini,
        maxOutputTokens: maxTokensGemini
      }
    });

    const chat = model.startChat({ history });
    const result = await chat.sendMessage(summaryRequest);
    return result.response.text() || "ERROR RESUMEN";
  } catch (error) {
    console.error("Error al generar resumen con Gemini:", error);
    return "ERROR RESUMEN";
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
        case "1": modelGemini = "gemini-3.5-flash-lite"; break;
        case "2": modelGemini = "models/gemma-4-26b-a4b-it"; break;
        case "3": modelGemini = "models/gemma-4-31b-it"; break;
        case "4": modelGemini = "models/gemini-2.5-flash"; break;
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

    // Resetea el usuario
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

    // Agrega un hecho al usuario
    if (config.startsWith(process.env.CONFIG_ADD_FACT)) {
      const userName = config.substring(process.env.CONFIG_ADD_FACT.length, config.indexOf("-")).trim();
      const fact = config.substring(config.indexOf("-") + 1).trim();
      if (users[userName]) {
        users[userName].addMessage("system", fact);
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
        const user = users[userName];
        return `${userName}: ${user.getContUserMessages()} mensajes`;
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

    // Retorna la lista de mensajes de un usuario
    if (config.startsWith(process.env.CONFIG_GET_MSGS)) {
      const userName = config.substring(process.env.CONFIG_GET_MSGS.length).trim();
      if (users[userName]) {
        const userMessages = users[userName].getMessages().map((msg) => `${msg.role}: ${msg.content}`).join("\n");
        console.log("Lista de mensajes del usuario:", userName, userMessages);
        return "Lista de mensajes del usuario:\n" + userMessages;
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

      const fistTimeUser = !users[msg.name];
      let msgText = msg.text;

      if (fistTimeUser) {
        let userContext = "unknown";
        if (isUserWithContext)
          userContext = getUserContextFromJson(msg.name);

        if (userContext === "unknown") {
          userContext = unknownContext + " Su nombre de usuario es " + msg.name + ".";
        }

        let newUser = new User(msg.name, userContext, null);
        console.log("Nuevo usuario creado:", msg.name);

        newUser.addMessage("system", `${selfContext} \n ${context} \n ${userContext}`);
        users[msg.name] = newUser;
      } else {
        if (users[msg.name].getMessages().length > maxMessagesPerUser) {
          const summary = await generateBotSummary(users[msg.name]);
          users[msg.name].summarizeMessages(summary, preserveLastMsg);
          users[msg.name].addMessage("system", summary);
        }
      }

      const user = users[msg.name];
      if (user) {
        user.addMessage("user", msgText);
      }

      try {
        const botResponseText = await generateBotResponse(user);
        const botResponse = { name: "ArielGPT", text: botResponseText };

        if (user) {
          user.addMessage("assistant", botResponseText);
        }

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
  let botResponseText = "";
  switch (automatic_mode) {
    case "start":
      botResponseText = await generateBotResponse(userModeStart);
      break;
    case "cena":
      botResponseText = await generateBotResponse(userModeCena);
      break;
    case "baile":
      botResponseText = await generateBotResponse(userModeBaile);
      break;
    default:
      botResponseText = "Modo desconocido.";
  }
  return botResponseText;
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
