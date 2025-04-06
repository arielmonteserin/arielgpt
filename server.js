const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

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

// Función que genera una respuesta temporal del bot
async function generateBotResponse(userMessage) {
  // Respuesta simple que simula la respuesta del bot
  return `Respuesta: ${userMessage}`;
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
    console.log("Nuevo mensaje de usuario:", socket.id, msg);
    messages.push(msg);
    // Reenviamos el mensaje al usuario que lo envió
    socket.emit("receive_message", msg);
    // Reenviamos el mensaje a la tablet
    if (tabletSocketId) {
      io.to(tabletSocketId).emit("receive_message", msg);
      // Aquí se invoca la lógica del bot para generar la respuesta
      try {
        //const botResponse = await generateBotResponse(msg.text); // Por ejemplo, utilizando un LLM o servicio externo
        const botResponse = { name: "Bot", text: `Respuesta a: ${msg.text}`};

        // Enviar la respuesta a la tablet y al usuario original
        socket.emit("receive_message", botResponse, socket.id);
        if (tabletSocketId) {
          io.to(tabletSocketId).emit("receive_message", botResponse);//`${msg.name}: ${botResponse}`);
        }
      } catch (error) {
        console.error("Error al generar respuesta del bot:", error);
      }
    }
  });

  socket.on("disconnect", () => {
    console.log("Usuario desconectado", socket.id);
    if (socket.id === tabletSocketId) {
      tabletSocketId = null; // Limpiamos el socket.id si la tablet se desconecta
      console.log("Tablet desconectada");
    }
  });
});

//server.listen(3001, () => console.log("Servidor WebSocket en puerto 3001"));
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Servidor WebSocket en puerto ${PORT}`));
