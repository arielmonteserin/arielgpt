const fs = require("fs");
const levenshtein = require("fast-levenshtein");

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const Anthropic = require("@anthropic-ai/sdk");
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

// Configuración de Anthropic (Claude)
const anthropic = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });

const users = {};
const maxMessagesPerUser = 10;
const preserveLastMsg = 3;

let automatic_mode = "start";

let selfContext = "";
let context = "";
let modelClaude = "claude-sonnet-4-5";
let temperatureClaude = 0.5;
let maxTokensClaude = 1024;
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

// Los User para modo automático no necesitan instancia de groq; pasamos null
const userModeStart = new User("userModeStart", selfContext + " " + context, null);
userModeStart.addMessage("system", `${selfContext} ${context} ${contextData.userModeStart}`);
const userModeCena = new User("userModeStart", selfContext + " " + context, null);
userModeCena.addMessage("system", `${selfContext} ${context} ${contextData.userModeCena}`);
const userModeBaile = new User("userModeStart", selfContext + " " + context, null);
userModeBaile.addMessage("system", `${selfContext} ${context} ${contextData.userModeBaile}`);

/**
 * Separa los mensajes del historial del usuario en:
 * - systemPrompt: concatenación de todos los mensajes con role "system"
 * - chatMessages: solo mensajes con role "user" o "assistant"
 * Claude requiere que el system prompt se pase como parámetro separado.
 */
function splitMessagesForClaude(allMessages) {
  const systemParts = [];
  const chatMessages = [];
  for (const msg of allMessages) {
    if (msg.role === "system") {
      systemParts.push(msg.content);
    } else {
      chatMessages.push({ role: msg.role, content: msg.content });
    }
  }
  return {
    systemPrompt: systemParts.join("\n"),
    chatMessages
  };
}

// Genera una respuesta usando Claude
async function generateBotResponse(user) {
  console.log("Enviado al bot:", user.getMessages());
  const { systemPrompt, chatMessages } = splitMessagesForClaude(user.getMessages());

  try {
    const response = await anthropic.messages.create({
      model: modelClaude,
      max_tokens: maxTokensClaude,
      temperature: temperatureClaude,
      system: systemPrompt,
      messages: chatMessages
    });

    const text = response.content[0]?.text || "No se pudo generar una respuesta.";
    console.log("Respuesta generada por Claude:", text);
    return text;
  } catch (error) {
    console.error("Error al generar respuesta con Claude:", error);
    return "Lo siento, no puedo responder en este momento.";
  }
}

// Resume un conjunto de mensajes del usuario usando Claude
async function generateBotSummary(user) {
  console.log("Enviado al bot para resumir:", user.getMessages());
  const allMessages = user.getMessages();
  const messagesToSummary = allMessages.slice(1, -preserveLastMsg);
  const { systemPrompt, chatMessages } = splitMessagesForClaude(messagesToSummary);

  const summaryMessages = [
    ...chatMessages,
    {
      role: "user",
      content: "Resume los mensajes anteriores. Haz foco en los hechos relevantes que comentó el usuario."
    }
  ];

  try {
    const response = await anthropic.messages.create({
      model: modelClaude,
      max_tokens: maxTokensClaude,
      temperature: temperatureClaude,
      system: systemPrompt,
      messages: summaryMessages
    });

    return response.content[0]?.text || "ERROR";
  } catch (error) {
    console.error("Error al generar resumen con Claude:", error);
    return "ERROR";
  }
}

// Aplica un cambio de configuración basado en el mensaje recibido
function applyConfigurationChange(config, socket) {
  try {
    // Cambia la temperatura
    if (config.startsWith(process.env.CONFIG_TEMP)) {
      const newTemperature = parseFloat(config.substring(process.env.CONFIG_TEMP.length));
      if (!isNaN(newTemperature)) {
        temperatureClaude = newTemperature;
        console.log("Nueva temperatura configurada:", temperatureClaude);
        return "Nueva temperatura configurada:" + temperatureClaude;
      } else {
        return "Error: La temperatura no es un número válido.";
      }
    }

    // Cambia el modelo
    if (config.startsWith(process.env.CONFIG_SET_LLM)) {
      const newModel = config.substring(process.env.CONFIG_SET_LLM.length).trim();
      switch (newModel) {
        case "0": modelClaude = "claude-opus-4-5"; break;
        case "1": modelClaude = "claude-sonnet-4-5"; break;
        case "2": modelClaude = "claude-haiku-3-5"; break;
        case "3": modelClaude = "claude-3-opus-20240229"; break;
        case "4": modelClaude = "claude-3-sonnet-20240229"; break;
        case "5": modelClaude = "claude-3-haiku-20240307"; break;
        default: return "Modelo no válido";
      }
      console.log("Nuevo modelo configurado:", modelClaude);
      return "Nuevo modelo configurado:" + modelClaude;
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
        - Temperatura: ${temperatureClaude}
        - Modelo: ${modelClaude}
        - Max Tokens: ${maxTokensClaude}
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
