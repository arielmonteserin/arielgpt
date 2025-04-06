// app/page.js
"use client";
import ChatApp from "../chatapp-frontend/src/components/ChatApp";

export default function Home() {
  return (
    <div className="flex items-center justify-center h-screen bg-gray-900">
      <ChatApp />
    </div>
  );
}