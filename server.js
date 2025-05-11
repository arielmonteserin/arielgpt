// Clase User para almacenar información del usuario
class User {
  constructor(name) {
    this.name = name; // Nombre del usuario
    this.context = ""; // Contexto del usuario (puedes inicializarlo vacío o con un valor predeterminado)
    this.messages = []; // Lista de mensajes intercambiados
  }

  // Agregar un mensaje a la lista
  addMessage(role, content) {
    this.messages.push({ role, content });
  }

  // Establecer el contexto del usuario
  setContext(context) {
    this.context = context;
  }

  // Obtener el contexto del usuario
  getContext() {
    return this.context;
  }

  // Obtener todos los mensajes
  getMessages() {
    return this.messages;
  }
}
const fs = require("fs"); // Importar el módulo fs para leer archivos
const levenshtein = require("fast-levenshtein"); // Instalar este paquete para calcular la distancia de Levenshtein

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const { Groq } = require("groq-sdk"); // Importar el SDK de Groq

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
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY, // Configurar esta variable en Render.com
});

const users = {};

//console.log("GROQ_API_KEY:", process.env.GROQ_API_KEY);

// Leer el archivo context.json al iniciar el servidor
let selfContext = ""; // Constante para almacenar el texto de la clave "self"
let context = "";
//let modelGroq = "llama-3.3-70b-versatile"; // Modelo sugerido
let modelGroq = "gemma2-9b-it";
let temperatureGroq = 0.5; // Controla la aleatoriedad de la respuesta
let frequency_penaltyGroq=2;
try {
  const contextData = JSON.parse(fs.readFileSync("/etc/secrets/context.json", "utf8")); // Leer y parsear el archivo JSON
  selfContext = contextData.self || ""; // Asignar el texto de la clave "self" a selfContext
  context = contextData.context || ""; // Asignar el texto de la clave "context" a context
  unknownContext = contextData.unknown || ""; // Asignar el texto de la clave "unknown" a unknownContext
  console.log("Contexto cargado correctamente:", selfContext);
} catch (error) {
  console.error("Error al leer el archivo context.json:", error);
}

// Función que genera una respuesta del bot utilizando Groq
// Esta función toma el usuario y el mensaje del usuario como parámetros
// y devuelve la respuesta generada por el modelo
async function generateBotResponse(user) {
  console.log("Enviado al bot:", user.getMessages());
  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: user.getMessages(), // Mensajes del usuario
      temperature: temperatureGroq, // Controla la aleatoriedad de la respuesta
      frequency_penalty: frequency_penaltyGroq, // Penaliza la repetición de palabras
      model: modelGroq, // Modelo sugerido
    });

    // Devuelve el contenido de la respuesta generada por el modelo
    return chatCompletion.choices[0]?.message?.content || "No se pudo generar una respuesta.";
  } catch (error) {
    console.error("Error al generar respuesta con Groq:", error);
    return "Lo siento, no puedo responder en este momento.";
  }
}

io.on("connection", (socket) => {
  console.log("Nuevo usuario conectado", socket.id);

  // Detectamos si la conexión es de la tablet
  socket.on("tablet_connected", () => {
    tabletSocketId = socket.id; // Guardamos el socket.id de la tablet
    console.log("Tablet conectada con socket.id:", tabletSocketId);
  });

  // Cuando un usuario envía un mensaje
  socket.on("send_message", async (msg) => {

    // Reenviamos el mensaje al usuario que lo envió
    socket.emit("receive_message", msg);

    // Reenviamos el mensaje a la tablet, si está conectada
    if (tabletSocketId) {
      io.to(tabletSocketId).emit("receive_message", msg);
    }

    
    console.log("Nuevo mensaje de usuario:", socket.id, msg);

    // Si es la primera vez que el usuario se conecta, creamos un nuevo objeto User
    const fistTimeUser = !users[msg.name];
    let msgText = msg.text
    if (fistTimeUser) {
      // Acá se debe recuperar el contexto del usuario desde el archivo JSON
      // y asignarlo al nuevo objeto User
      const userContext = getUserContextFromJson(msg.name);
      users[msg.name] = new User(msg.name, userContext); // Crear un nuevo usuario
      console.log("Nuevo usuario creado:", msg.name);

      msgText = `${selfContext} ${userContext} ${context} Sos Ariel, responde el siguiente mensaje de ${msg.name}: ${msgText}`;
    }
    else {
      // No es el primer mensaje del usuario, así que solo agregamos el mensaje al historial
      msgText = `Sos Ariel, responde el siguiente mensaje de ${msg.name}: ${msgText}`;
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
        user.addMessage("system", botResponseText); // Agregar mensaje con rol "bot"
      }

      // Enviar la respuesta al usuario y a la tablet
      socket.emit("receive_message", botResponse);
      if (tabletSocketId) {
        io.to(tabletSocketId).emit("receive_message", botResponse);
      }
    } catch (error) {
      console.error("Error al generar respuesta de ArielGPT:", error);
    }
  });

  // Cuando un usuario se desconecta
  socket.on("disconnect", () => {
    console.log("Usuario desconectado", socket.id);

    // Eliminar al usuario de la lista de usuarios conectados
    delete users[socket.id];

    if (socket.id === tabletSocketId) {
      tabletSocketId = null; // Limpiamos el socket.id si la tablet se desconecta
      console.log("Tablet desconectada");
    }
  });
});

/**
 * Función para obtener el contexto del usuario desde el archivo JSON
 * @param {string} name - Nombre del usuario
 * @returns {string} - Contexto asociado al usuario o un valor predeterminado
 */
function getUserContextFromJson(name) {
  try {
    // Leer y parsear el archivo JSON
    const contextData = JSON.parse(fs.readFileSync("context.json", "utf8"));

    // Obtener todas las claves del archivo JSON
    const keys = Object.keys(contextData);

    // Buscar la clave más similar al nombre del usuario
    let closestKey = null;
    let smallestDistance = Infinity;

    keys.forEach((key) => {
      const distance = levenshtein.get(name.toLowerCase(), key.toLowerCase());
      if (distance < smallestDistance) {
        smallestDistance = distance;
        closestKey = key;
      }
    });

    // Si la distancia es razonable, devolvemos el contexto asociado
    if (smallestDistance <= 3) { // Ajusta este umbral según tus necesidades
      return contextData[closestKey];
    }

    // Si no se encuentra una clave similar, devolvemos un valor predeterminado
    return contextData['unknown'] || "No se encontró contexto para el usuario.";
  } catch (error) {
    console.error("Error al leer el archivo context.json:", error);
    return "Error al cargar el contexto del usuario.";
  }
}

//server.listen(3001, () => console.log("Servidor WebSocket en puerto 3001"));
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Servidor WebSocket en puerto ${PORT}`));
