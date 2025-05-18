class User {
  constructor(name, context, groq) {
    this.name = name;
    this.context = context;
    // Lista de mensajes preparados para enviar al modelo
    this.messages = [];
    this.groq = groq;
    this.contUserMessages = 0;
  }

  setGroq(groq) {
    this.groq = groq;
  }

  getGroq() {
    return this.groq;
  }

  addMessage(role, content) {
    this.messages.push({ role, content });
    if (role === "user") {
      this.contUserMessages++;
    }
  }

  summarizeMessages(summary, preserveLastMsg) {
    console.log(`Summarizing messages for ${this.name}`);
    console.log(`Messages before summarization: ${JSON.stringify(this.messages)}`);
    
    this.messages = this.messages.slice(0, 1).concat(this.messages.slice(-preserveLastMsg));
    this.messages.unshift({ role: "system", content: summary });

    console.log(`Messages after summarization: ${JSON.stringify(this.messages)}`);
  }

  setContext(context) {
    this.context = context;
  }

  getContext() {
    return this.context;
  }

  getMessages() {
    return this.messages;
  }

  getName() {
    return this.name;
  }
  
  getContUserMessages() {
    return this.contUserMessages;
  }
}

module.exports = User;
