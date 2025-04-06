import { useState } from "react";
import { motion } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function ChatApp() {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [messages, setMessages] = useState([]);

  const handleLogin = (e) => {
    e.preventDefault();
    if (name && password) setLoggedIn(true);
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!message) return;

    const newMessage = { name, text: message };
    setMessages([...messages, newMessage]);
    setMessage("");
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-r from-purple-600 to-blue-400 text-white p-4">
      <motion.h1
        className="text-4xl font-bold mb-6 text-center"
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        ?? Chat con ChatGPT ??
      </motion.h1>
      {!loggedIn ? (
        <Card className="w-full max-w-md p-6 bg-white text-black rounded-2xl shadow-lg">
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <Input placeholder="Tu Nombre" value={name} onChange={(e) => setName(e.target.value)} required />
              <Input type="password" placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)} required />
              <Button type="submit" className="w-full bg-purple-600 hover:bg-purple-700">
                Iniciar Chat ??
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card className="w-full max-w-md p-6 bg-white text-black rounded-2xl shadow-lg">
          <CardContent>
            <div className="mb-4 h-64 overflow-y-auto bg-gray-100 p-4 rounded-lg text-black">
              {messages.length === 0 ? (
                <p className="text-center text-gray-500">No hay mensajes aún</p>
              ) : (
                messages.map((msg, index) => (
                  <div key={index} className="mb-2 p-2 bg-purple-200 rounded-lg">
                    <strong>{msg.name}:</strong> {msg.text}
                  </div>
                ))
              )}
            </div>
            <form onSubmit={handleSendMessage} className="space-y-4">
              <Input placeholder="Tu Mensaje" value={message} onChange={(e) => setMessage(e.target.value)} required />
              <Button type="submit" className="w-full bg-purple-600 hover:bg-purple-700">
                Enviar Mensaje ??
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
