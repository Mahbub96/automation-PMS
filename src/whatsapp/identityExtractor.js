async function extractWhatsAppIdentity(message) {
  const contact = await message.getContact();
  return {
    whatsappName: contact.pushname || contact.name || contact.number || "unknown",
    phone: contact.number || null,
    senderId: message.author || message.from,
  };
}

module.exports = { extractWhatsAppIdentity };
