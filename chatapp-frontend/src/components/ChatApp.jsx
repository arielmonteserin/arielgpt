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
    //if (name && password === process.env.PASSWORD) {
    const PASSWORD = import.meta.env.VITE_APP_PASSWORD;
    //const PASSWORD = process.env.PASSWORD;
    if (name && password === PASSWORD) {
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
    <div className="flex flex-col min-h-screen bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 text-white">
      {/* Header */}
      <header className="text-2xl font-bold bg-blue-600 p-4 shadow-lg text-center flex-shrink-0">
        Mateo cumple 18
      </header>

      {/* Main Content */}
      <div className="flex-grow flex items-center justify-center overflow-y-auto">
        <div className="bg-white text-black p-4 rounded-lg shadow-lg w-80">
          {!loggedIn ? (
            <div className="text-center">
              <input
                type="text"
                placeholder="Nombre"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full p-2 border rounded mb-2 text-center"
              />
              <input
                type="password"
                placeholder="Contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full p-2 border rounded mb-2 text-center"
              />
              <button
                onClick={handleLogin}
                className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-700"
              >
                Ingresar
              </button>
            </div>
          ) : (
            <div className="text-center">
              <div className="h-40 overflow-y-auto border p-2 mb-2 bg-gray-100 rounded">
                {/* Scrollable messages */}
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
                className="w-full p-2 border rounded mb-2 text-center"
              />
              <button
                onClick={sendMessage}
                className="w-full bg-green-500 text-white p-2 rounded hover:bg-green-700"
              >
                Enviar
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="text-sm bg-gray-800 p-4 shadow-lg text-center flex-shrink-0">
        ArielGPT - Todos los izquierdos reservados
      </footer>
    </div>
  );
}
