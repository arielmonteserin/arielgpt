// app/components/ChatApp.js
"use client";
import { useState, useEffect } from "react";
import io from "socket.io-client";

//const socket = io("http://localhost:3001");
//const socket = io(
//  typeof window !== "undefined" && window.location.hostname === "localhost"
//    ? "http://localhost:3001"
//    : "wss://arielgpt.onrender.com"
//);
const socket = io("https://arielgpt.onrender.com");


export default function ChatApp() {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    socket.on("receive_message", (newMessage) => {
      setMessages((prevMessages) => [...prevMessages, newMessage]);
    });
    return () => socket.off("receive_message");
  }, []);

  const handleLogin = () => {
    if (name && password === process.env.PASSWORD) {
      setLoggedIn(true);
    }
  };

  const sendMessage = () => {
    if (!message.trim()) return;
    const newMessage = { name, text: message };
    socket.emit("send_message", newMessage);
    setMessage(""); // Clear input after sending
  };

  return (
    <div className="bg-white p-4 rounded-lg shadow-lg w-80">
      {!loggedIn ? (
        <div>
          <input
            type="text"
            placeholder="Nombre"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full p-2 border rounded mb-2"
          />
          <input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full p-2 border rounded mb-2"
          />
          <button
            onClick={handleLogin}
            className="w-full bg-blue-500 text-white p-2 rounded"
          >
            Ingresar
          </button>
        </div>
      ) : (
        <div>
          <div className="h-40 overflow-y-auto border p-2 mb-2">
            {/* Filtrar solo los mensajes propios y las respuestas asociadas */}
            {messages.map((msg, index) => (
              <div key={index} className="mb-1">
                <strong>{msg.name}:</strong> {msg.text}
                {/* Mostrar la respuesta del Bot si existe */}
                {msg.response && (
                  <div className="mt-1 text-green-500">
                    <strong>Bot:</strong> {msg.response}
                  </div>
                )}
              </div>
            ))}
          </div>
          <input
            type="text"
            placeholder="Escribe un mensaje..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="w-full p-2 border rounded mb-2"
          />
          <button
            onClick={sendMessage}
            className="w-full bg-green-500 text-white p-2 rounded"
          >
            Enviar
          </button>
        </div>
      )}
    </div>
  );
}
