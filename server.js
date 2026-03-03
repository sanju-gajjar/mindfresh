const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = {};

io.on("connection", (socket) => {

  socket.on("create-room", () => {
    const roomId = uuidv4().slice(0, 6);
    rooms[roomId] = true;
    socket.join(roomId);
    socket.emit("room-created", roomId);
  });

  socket.on("join-room", (roomId) => {

    // If room doesn't exist → create it automatically
    if (!rooms[roomId]) {
      rooms[roomId] = true;
    }

    socket.join(roomId);
    socket.emit("room-joined", roomId);

    socket.to(roomId).emit("user-joined", socket.id);
  });

  socket.on("chat-message", ({ roomId, message }) => {
    io.to(roomId).emit("chat-message", {
      sender: socket.id,
      message
    });
  });

  socket.on("remove-image", (imageId) => {
    const messages = document.querySelectorAll(".message");
    messages.forEach(msg => {
      if (msg.dataset.id === imageId) {
        msg.remove();
      }
    });
  });
  socket.on("send-image", ({ roomId, image, imageId }) => {
    io.to(roomId).emit("receive-image", {
      sender: socket.id,
      image,
      imageId
    });
  });

  socket.on("delete-image", ({ roomId, imageId }) => {
    io.to(roomId).emit("remove-image", imageId);
  });
});

server.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});