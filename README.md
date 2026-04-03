# MindFresh Chat Application

A real-time chat application with video calling capabilities.

## Features

- Real-time text chat with end-to-end encryption
- Room-based chat (up to 2 members per room)
- Video calling with persistent small video windows
- Emoji and GIF support
- Stranger matching mode
- Mobile responsive design

## Video Calling

### Room Video (Persistent Small Videos)
When joining a room, small video windows automatically appear at the top of the chat showing:
- Your own video feed
- Your partner's video feed (when available)

**Controls:**
- **Room Video Button**: Toggle the persistent video windows on/off
- Videos are enabled by default when joining a room
- Your preference is saved and persists across sessions

### Full-Screen Video Calls
Traditional video calling with full-screen overlay and controls.

## Mobile Browser Support

⚠️ **Important**: For video functionality to work on mobile browsers, the application must be served over HTTPS. Mobile browsers require secure connections for camera/microphone access.

### Development
For local development on mobile devices:
1. Use a tool like `ngrok` or `localtunnel` to create HTTPS tunnels
2. Or deploy to a hosting service with SSL certificates

### Example with ngrok:
```bash
npm start
# In another terminal
npx ngrok http 3000
# Use the HTTPS URL provided by ngrok
```

## Installation

1. Clone the repository
2. Install dependencies: `npm install`
3. Start the server: `npm start`
4. Open `http://localhost:3000` in your browser

## Technologies

- Node.js
- Express
- Socket.IO
- WebRTC
- HTML5 Video API