// app/components/ChatApp.js
//"use client";
import { useState, useEffect, useRef } from "react";
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
  const [users, setUsers] = useState([]);
  const [selectedRealName, setSelectedRealName] = useState("");
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    socket.on("receive_message", (newMessage) => {
      setMessages((prevMessages) => [...prevMessages, newMessage]);
    });
    return () => socket.off("receive_message");
  }, []);

  useEffect(() => {
    // Scroll al último mensaje cuando cambian los mensajes
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Cargar users.json al montar el componente
  useEffect(() => {
    fetch("/users.json")
      .then((res) => res.json())
      .then((data) => {
        // Si el archivo tiene una propiedad 'users' que es un array, úsala
        if (data && Array.isArray(data.users)) {
          setUsers(data.users);
        } else if (Array.isArray(data)) {
          setUsers(data);
        } else {
          setUsers([]);
        }
      })
      .catch(() => setUsers([]));
  }, []);

  // Cuando se selecciona un nombre real, setea el nombre real en el input
  useEffect(() => {
    if (selectedRealName) {
      setName(selectedRealName); // Mostrar el nombre real en el input
    } else {
      setName(""); // Borra el campo de texto si se deselecciona
    }
  }, [selectedRealName]);

  const handleLogin = () => {
    const PASSWORD = import.meta.env.VITE_PASSWORD;
    let userToSend = name;
    // Si seleccionó un nombre real de la lista, antepone #
    if (selectedRealName && users.includes(selectedRealName)) {
      userToSend = "#" + selectedRealName;
    }
    if (name && password === PASSWORD) { //PASSWORD
      setLoggedIn(true);
      setName(userToSend); // Sobrescribe el nombre con el valor a enviar
    }
  };

  const sendMessage = () => {
    if (!message.trim()) return;
    const newMessage = { name, text: message };
    socket.emit("send_message", newMessage);
    setMessage(""); // Clear input after sending
    //if (inputRef.current) {
    //  inputRef.current.focus();
    //}
  };

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 text-white overflow-x-hidden">
      {/* Header */}
      <header className="text-2xl font-bold bg-[#10A37F] p-4 shadow-lg text-center flex-shrink-0">
        <span className="animate-bounce bg-gradient-to-r from-purple-200 to-pink-200 bg-clip-text text-white inline-flex items-center gap-2">
          🎉 <span className="animate-pulse">¡Matu cumple 18!</span> 🥳
        </span>
      </header>

      {/* Main Content */}
      <div className="flex-grow flex items-center justify-center w-full">
        <div className="bg-white text-black p-0 rounded-lg shadow-lg w-full max-w-2xl flex flex-col h-[80vh]">
          {!loggedIn ? (
            <div className="text-center p-4">
              <div className="mb-4 text-lg font-semibold text-purple-700">
                ¡Bienvenido a los 18 de Matu (Toto para los amigos)! Ingresá tu nombre y la contraseña para chatear con ArielGPT.
              </div>
              {/* DropDownList de nombres reales */}
              <select
                className="w-full p-2 border rounded mb-2 text-center bg-white"
                value={selectedRealName}
                onChange={e => setSelectedRealName(e.target.value)}
              >
                <option value="">Seleccioná tu nombre real (opcional)</option>
                {users.map((realName) => (
                  <option key={realName} value={realName}>
                    {realName}
                  </option>
                ))}
              </select>
              <div className="mb-2 text-sm text-purple-700">
                En caso de no estar en la lista, ingresa tu nombre:
              </div>
              <input
                type="text"
                placeholder="Nombre"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full p-2 border rounded mb-2 text-center"
                disabled={!!selectedRealName}
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
                className="w-full bg-[#10A37F] text-white p-2 rounded hover:bg-blue-700"
              >
                Ingresar
              </button>
            </div>
          ) : (
            <div className="flex flex-col h-full">
              <div className="flex-1 overflow-y-auto border p-2 mb-2 rounded bg-gradient-to-br from-blue-100 via-purple-100 to-pink-100 w-full">
                {/* Scrollable messages */}
                {messages.map((msg, index) => (
                  <div key={index} className="mb-2">
                    <strong className="text-orange-600">{msg.name}:</strong> {msg.text}
                    {msg.response && (
                      <div className="mt-1 text-green-600">
                        <strong>Bot:</strong> {msg.response}
                      </div>
                    )}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
              <div className="mt-auto flex flex-col gap-2 p-2 bg-gradient-to-r from-purple-200 via-pink-200 to-red-200 w-full">
                <textarea
                  placeholder="Escribe un mensaje..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="w-full min-h-[3.5rem] max-h-32 p-3 border-2 border-purple-400 rounded resize-none text-center bg-white focus:outline-none focus:ring-2 focus:ring-purple-400"
                  style={{ fontSize: "1.1rem" }}
                  ref={inputRef}
                />
                <button
                  onClick={sendMessage}
                  className="w-full bg-gradient-to-r from-green-400 to-green-600 text-white p-3 rounded font-bold text-lg hover:from-green-500 hover:to-green-700 transition"
                >
                  Enviar
                </button>
              </div>
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
