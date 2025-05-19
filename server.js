const fs = require("fs"); // Importar el módulo fs para leer archivos
const levenshtein = require("fast-levenshtein"); // Instalar este paquete para calcular la distancia de Levenshtein

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const { Groq } = require("groq-sdk"); // Importar el SDK de Groq
const User = require("./User");
const { timeStamp } = require("console");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Permite todos los orígenes. Puedes cambiarlo a una URL específica si es necesario
    methods: ["GET", "POST"]
  }
});

app.use(express.json());
app.use(cors());

let messages = [];
let tabletSocketId = null; // Almacenamos el socket.id de la tablet

// Configuración de Groq
const groqs = [new Groq({ apiKey: process.env.GROQ_API_KEY }),
new Groq({ apiKey: process.env.GROQ_API_KEY_1 }),
new Groq({ apiKey: process.env.GROQ_API_KEY_2 }),
new Groq({ apiKey: process.env.GROQ_API_KEY_3 })];


const users = {};
const maxMessagesPerUser = 10; // Número máximo de mensajes por usuario

const preserveLastMsg = 3;
let indexGroq = 0; // Índice para seleccionar el objeto Groq

let automatic_mode = "start";

// Leer el archivo context.json al iniciar el servidor
let selfContext = ""; // Constante para almacenar el texto de la clave "self"
let context = "";
//let modelGroq = "llama-3.3-70b-versatile"; // Modelo sugerido
let modelGroq = "gemma2-9b-it";
let temperatureGroq = 0.5; // Controla la aleatoriedad de la respuesta
let frequency_penaltyGroq = 2;
let contextData = "{}"; // Inicializar contextData como un objeto vacío
// Levanta el Json con contextos de los usuarios
try {
  //const contextData = JSON.parse(fs.readFileSync("/etc/secrets/context.json", "utf8"));
  contextData = JSON.parse(fs.readFileSync("context.json", "utf8")); // Leer y parsear el archivo JSON
  selfContext = contextData.self || ""; // Asignar el texto de la clave "self" a selfContext
  context = contextData.context || ""; // Asignar el texto de la clave "context" a context
  unknownContext = contextData.unknown || ""; // Asignar el texto de la clave "unknown" a unknownContext
  console.log("Contexto cargado correctamente:", selfContext);
} catch (error) {
  console.error("Error al leer el archivo context.json:", error);
}

const userModeStart = new User("userModeStart", selfContext + " " + context, groqs[0]);
userModeStart.addMessage("system", `${selfContext} ${context} ${contextData.userModeStart}`);
const userModeCena = new User("userModeStart", selfContext + " " + context, groqs[1]);
userModeCena.addMessage("system", `${selfContext} ${context} ${contextData.userModeCena}`);
const userModeBaile = new User("userModeStart", selfContext + " " + context, groqs[2]);
userModeBaile.addMessage("system", `${selfContext} ${context} ${contextData.userModeBaile}`)



// Función que genera una respuesta del bot utilizando Groq
// Esta función toma el usuario y el mensaje del usuario como parámetros
// y devuelve la respuesta generada por el modelo
async function generateBotResponse(user) {
  console.log("Enviado al bot:", user.getMessages());
  userGroq = user.getGroq();
  try {
    const chatCompletion = await userGroq.chat.completions.create({
      messages: user.getMessages(), // Mensajes del usuario
      temperature: temperatureGroq, // Controla la aleatoriedad de la respuesta
      frequency_penalty: frequency_penaltyGroq, // Penaliza la repetición de palabras
      model: modelGroq, // Modelo sugerido
    });

    // Devuelve el contenido de la respuesta generada por el modelo
    console.log("Respuesta generada por Groq:", chatCompletion.choices[0]?.message?.content);
    return chatCompletion.choices[0]?.message?.content || "No se pudo generar una respuesta.";
  } catch (error) {
    console.error("Error al generar respuesta con Groq:", error);
    return "Lo siento, no puedo responder en este momento.";
  }
}


// Función que resume un conjunto de mensajes del usuario
async function generateBotSummary(user) {
  console.log("Enviado al bot para resumir:", user.getMessages());
  messages = user.getMessages();
  messagesToSummary = messages.slice(1, -preserveLastMsg); // Tomar solo los últimos 10 mensajes
  messagesToSummary.push({
    role: "user", // o System?
    content: "Resume los mensajes anteriores. Haz foco en los hechos relevantes que comentó el usuario."
  });
  userGroq = user.getGroq();

  try {
    const chatCompletion = await userGroq.chat.completions.create({
      messages: messagesToSummary, // Mensajes del usuario
      temperature: temperatureGroq, // Controla la aleatoriedad de la respuesta
      frequency_penalty: frequency_penaltyGroq, // Penaliza la repetición de palabras
      model: modelGroq, // Modelo sugerido
    });

    // Devuelve el contenido de la respuesta generada por el modelo
    return chatCompletion.choices[0]?.message?.content || "ERROR";
  } catch (error) {
    console.error("Error al generar respuesta con Groq:", error);
    return "ERROR";
  }
}

// Función que aplica un cambio de configuración basado en el mensaje recibido
function applyConfigurationChange(config, socket) {
  try {
    // Cambia la temperatura
    if (config.startsWith(process.env.CONFIG_TEMP)) {
      const newTemperature = parseFloat(config.substring(process.env.CONFIG_TEMP.length));
      if (!isNaN(newTemperature)) {
        temperatureGroq = newTemperature;
        console.log("Nueva temperatura configurada:", temperatureGroq);
        return "Nueva temperatura configurada:" + temperatureGroq;
      } else {
        console.error("Error: La temperatura no es un número válido.");
        return "Error: La temperatura no es un número válido.";
      }
    }
    // Cambia el modelo
    if (config.startsWith(process.env.CONFIG_SET_LLM)) {
      const newModel = config.substring(process.env.CONFIG_SET_LLM.length).trim();
      switch (newModel) {
        case "0": modelGroq = "gemma2-9b-it"; break;
        case "1": modelGroq = "llama3-70b-8192"; break;
        case "2": modelGroq = "llama-3.1-8b-instant"; break;
        case "3": modelGroq = "llama-guard-3-8b"; break; modelGroq = newModel;
        case "4": modelGroq = "mistral-saba-24b"; break;
        case "5": modelGroq = "llama-3.3-70b-versatile"; break;
        default: return false; // Modelo no válido
      }
      console.log("Nuevo modelo configurado:", modelGroq);
      return "Nuevo modelo configurado:" + modelGroq;
    }
    // Cambia el modo
    if (config.startsWith(process.env.CONFIG_SET_MODE)) {
      const newMode = config.substring(process.env.CONFIG_SET_MODE.length).trim();
      if (newMode === "start" || newMode === "cena" || newMode === "baile") {
        automatic_mode = newMode;
        console.log("Nuevo modo configurado:", automatic_mode);
        return "Nuevo modo configurado:" + automatic_mode;
      }
      else {
        return "Modo no válido";
      }
      console.log("Nuevo modo configurado:", frequency_penaltyGroq);
    }
    // Resetea el usuario
    if (config.startsWith(process.env.CONFIG_RESET_USER)) {
      const userName = config.substring(process.env.CONFIG_RESET_USER.length).trim();
      if (users[userName]) {
        delete users[userName]; // Eliminar el usuario del objeto users
        console.log("Usuario reseteado:", userName);
        return "Usuario reseteado:" + userName;
      } else {
        console.error("Error: Usuario no encontrado.");
        return "Error: Usuario no encontrado.";
      }
    }

    // Agrega un hecho al usuario
    if (config.startsWith(process.env.CONFIG_ADD_FACT)) {
      const userName = config.substring(process.env.CONFIG_ADD_FACT.length, config.indexOf(".")).trim();
      if (users[userName]) {
        const fact = config.substring(process.env.CONFIG_ADD_FACT.length).trim();
        users[userName].addMessage("system", fact); // Agregar el hecho al historial del usuario
        console.log("Hecho agregado al usuario:", userName, fact);
        return "Hecho agregado al usuario:" + userName + " " + fact;
      } else {
        console.error("Error: Usuario no encontrado.");
        return "Error: Usuario no encontrado.";
      }
    }

    // Lista los usuarios actuales con información básica
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
        - Temperatura: ${temperatureGroq}
        - Modelo: ${modelGroq}
        - Modo: ${automatic_mode}
      `;
      console.log("Configuración actual:", currentConfig);
      return "Configuración actual:\n" + currentConfig;
    }

    // Envia un mensaje directo a la tablet
    if (config.startsWith(process.env.CONFIG_DMSG)) {
      const message = config.substring(process.env.CONFIG_DMSG.length).trim();
      if (tabletSocketId) {
        io.to(tabletSocketId).emit("receive_message", { name: "ArielGPT", text: message });
        console.log("Mensaje enviado a la tablet:", message);
        return "Mensaje enviado a la tablet:" + message;
      } else {
        console.error("Error: Tablet no conectada.");
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
        console.error("Error: Usuario no encontrado.");
        return "Error: Usuario no encontrado.";
      }
    }

    // Habilita el envío de imágenes
    if (config.startsWith(process.env.CONFIG_ENABLE_IMG)) {
        socket.emit("enable_img");
        console.log("Imagen habilitada");
        return "Imagen habilitada";
    }

    return "Comando no reconocido."; // Comando no reconocido
  }
  catch (error) {
    console.error("Error al aplicar la configuración:", error);
    return "Error al aplicar la configuración:" +  error;
  }
}

// Variable para almacenar el timestamp de la última vez que se recibió un mensaje
let lastMessageReceivedAt = 0;

io.on("connection", (socket) => {
  console.log("Nuevo usuario conectado", socket.id);

  // Detectamos si la conexión es de la tablet
  socket.on("tablet_connected", () => {
    tabletSocketId = socket.id; // Guardamos el socket.id de la tablet
    console.log("Tablet conectada con socket.id:", tabletSocketId);
  });

  // Cuando un usuario envía un mensaje
  socket.on("send_message", async (msg) => {
    // Si el mensaje recibido comienza con "#" es un nombre real
    let isUserWithContext = false
    
    if (msg.name.startsWith("#")) {
      isUserWithContext = true;
      msg.name = msg.name.substring(1); // Eliminar el símbolo "#" del nombre
    }
    // Reenviamos el mensaje al usuario que lo envió
    socket.emit("receive_message", msg);

    // Si el mensaje recibido comienza con process.env.CONFIG_PREFIX es un comando de configuracion
    if (msg.text.startsWith(process.env.CONFIG_PREFIX)) {
      // Es un mensaje de configuración
      const config = msg.text.substring(process.env.CONFIG_PREFIX.length).trim();
      socket.emit("receive_message", { name: "ArielGPT", text: applyConfigurationChange(config, socket) });
    }
    else {
      // Reenviamos el mensaje a la tablet, si está conectada
      if (tabletSocketId) {
        io.to(tabletSocketId).emit("receive_message", msg);
      }

      console.log("Nuevo mensaje de usuario:", socket.id, msg);

      lastMessageReceivedAt = Date.now(); // Actualizamos el timestamp de la última vez que se recibió un mensaje

      // Si es la primera vez que el usuario se conecta, creamos un nuevo objeto User
      const fistTimeUser = !users[msg.name];
      let msgText = msg.text
      if (fistTimeUser) {
        // Acá se debe recuperar el contexto del usuario desde el archivo JSON
        // y asignarlo al nuevo objeto User
        let userContext = "unknown"; // Inicializamos el contexto como "unknown"
        if (isUserWithContext)
          userContext = getUserContextFromJson(msg.name);
        
        if (userContext === "unknown") {
          userContext = unknownContext + " Su nombre de usuario es " + msg.name + "."; // Asignar contexto desconocido mas el nombre del usuario
        }
        //console.log("groqs:", groqs);
        //console.log("indexGroq:", indexGroq);
        let newUser = new User(msg.name, userContext, groqs[indexGroq]); // Crear un nuevo usuario

        // Actualiza indice groq para proximo usuario
        indexGroq = (indexGroq + 1) % groqs.length; // Cambia al siguiente objeto Groq
        console.log("Nuevo usuario creado:", msg.name);

        //msgText = `${selfContext} ${userContext} ${context} Sos Ariel, responde el siguiente mensaje de ${msg.name}: ${msgText}`;
        newUser.addMessage("system", `${selfContext} ${userContext} ${context}`); // Agregar mensaje con rol "user"

        //msgText = `Responde el mensaje de ${msg.name}: ${msgText}`;
        // Dejamos el mensaje original

        users[msg.name] = newUser;
      }
      else {
        // No es el primer mensaje del usuario, así que solo agregamos el mensaje al historial
        //msgText = `Responde el mensaje de ${msg.name}: ${msgText}`;

        // Evaluamos si es necesario resumir los mensajes
        if (users[msg.name].getMessages().length > maxMessagesPerUser) {
          const summary = await generateBotSummary(users[msg.name]);
          users[msg.name].summarizeMessages(summary, preserveLastMsg); // Resumir mensajes
          users[msg.name].addMessage("system", summary); // Agregar resumen al historial
          //msgText = `${summary} ${msgText}`;
        }
      }

      // Agregar el mensaje enviado por el usuario a su historial
      const user = users[msg.name];
      if (user) {
        user.addMessage("user", msgText); // Agregar mensaje con rol "user"
      }

      // Generar respuesta del bot
      try {
        const botResponseText = await generateBotResponse(user); // Llamada a Groq
        const botResponse = { name: "ArielGPT", text: botResponseText };

        // Agregar la respuesta del bot al historial del usuario
        if (user) {
          user.addMessage("assistant", botResponseText); // Agregar mensaje con rol "bot"
        }

        // Enviar la respuesta al usuario y a la tablet
        socket.emit("receive_message", botResponse);
        if (tabletSocketId) {
          io.to(tabletSocketId).emit("receive_message", botResponse);
        }
      } catch (error) {
        console.error("Error al generar respuesta de ArielGPT:", error);
      }
    }
  });

  // Cuando un usuario se desconecta
  socket.on("disconnect", () => {
    console.log("Usuario desconectado", socket.id);

    // Eliminar al usuario de la lista de usuarios conectados
    //delete users[socket.id];

    if (socket.id === tabletSocketId) {
      tabletSocketId = null; // Limpiamos el socket.id si la tablet se desconecta
      console.log("Tablet desconectada");
    }
  });

  // Manejar imagen subida por el usuario
  socket.on("upload_img", (data) => {
    // data: { name, imgData }
    // Aquí puedes guardar la imagen, reenviarla, o procesarla como desees.
    // Por ejemplo, reenviar la imagen a la tablet:
    if (tabletSocketId) {
      io.to(tabletSocketId).emit("receive_message", {
        name: data.name,
        text: "[Imagen enviada]",
        imgData: data.imgData
      });
    }
    // También puedes guardar la imagen en disco si lo deseas:
    // const base64Data = data.imgData.replace(/^data:image\/\w+;base64,/, "");
    // fs.writeFileSync(`uploads/${Date.now()}_${data.name}.png`, base64Data, {encoding: 'base64'});
    console.log(`Imagen recibida de ${data.name}`);
  });
});

/**
 * Función para obtener el contexto del usuario desde el archivo JSON
 * @param {string} name - Nombre del usuario
 * @returns {string} - Contexto asociado al usuario o un valor predeterminado
 */
function getUserContextFromJson(name) {
  try {
    // Busca exactamente la clave dentro del contextData
    if (contextData.hasOwnProperty(name)) {
      return contextData[name];
    }
    // Si no se encuentra una clave exacta, devolvemos un valor predeterminado
    return "unknown" || "No se encontró contexto para el usuario.";
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

let timeInterval = 300000; // Variable para controlar el intervalo de tiempo

// Comportamiento repetido cada 5 minutos
setInterval(async () => {
  if (Date.now() - lastMessageReceivedAt < timeInterval) {

    return; // No se ha recibido un mensaje en el intervalo de tiempo especificado
  }
  // Reenviamos el mensaje a la tablet, si está conectada
  // Generar respuesta del bot
  try {
    // Enviar la respuesta a la tablet
    if (tabletSocketId) {
      const botResponseText = await generateBotAutomaticResponse(); // Genera respuesta en base al modo
      const botResponse = { name: "ArielGPT", text: botResponseText };
      io.to(tabletSocketId).emit("clear");
      console.log("Enviando mensaje a la tablet:", botResponse);
      io.to(tabletSocketId).emit("receive_message", botResponse);
    }
  } catch (error) {
    console.error("Error al generar respuesta automatica segun modo de ArielGPT:", error);
  }
}, timeInterval); // 300000 5 minutos en milisegundos

//server.listen(3001, () => console.log("Servidor WebSocket en puerto 3001"));
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Servidor WebSocket en puerto ${PORT}`));
