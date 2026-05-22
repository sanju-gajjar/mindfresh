You are working on an existing Node.js + Express.js + Socket.IO + WebRTC video chat application.

IMPORTANT:
- Do NOT rebuild the whole app
- Do NOT change existing architecture unnecessarily
- Extend the current implementation carefully
- Preserve existing chat + video calling functionality
- Refactor only where required
- Keep code modular and production-ready

Implement the following features and behavior exactly.

==================================================
FEATURE REQUIREMENTS
==================================================

1. USERNAME SYSTEM
--------------------------------------------------

Remove random username generation.

Implement deterministic usernames:

- First normal user => user1
- Second normal user => user2
- Third => user3
- Continue incrementally per room

If user manually enters:
- "admin"
- "Admin"
- "ADMIN"

Then:
- assign role = "admin"
- display username as "admin"

Username handling must be room-specific.

Examples:
Room A:
- user1
- user2

Room B:
- user1
- admin

Do not create duplicate usernames inside same room.

==================================================
2. DEFAULT MEDIA STATES
==================================================

On joining room:

LOCAL USER:
- video OFF by default
- mic MUTED by default

IMPORTANT:
- camera permission should NOT be requested automatically
- microphone permission should NOT be requested automatically
- permissions only requested when user explicitly enables device

REMOTE USER:
- remote video area should always render
- if remote enables camera, show automatically
- no video toggle needed on join screen

==================================================
3. JOIN SCREEN CHANGES
==================================================

Join screen should contain ONLY:

- room id input
- optional username input
- join button

REMOVE:
- prejoin camera preview
- prejoin mic toggle
- prejoin camera toggle

Keep UI clean.

==================================================
4. ROLE SYSTEM
==================================================

Roles:
- admin
- user

Admin permissions:
- toggle own mic/video
- toggle any participant mic
- toggle any participant video
- mute all users
- disable all videos

Normal users:
- can only control their own media

Server must validate admin permissions.
NEVER trust frontend role values.

==================================================
5. LOCAL MEDIA TOGGLE LOGIC
==================================================

VIDEO ENABLE:
- request webcam permission only when clicked
- create video track dynamically
- add/replace track in RTCPeerConnection
- notify peers using socket event

VIDEO DISABLE:
- stop video track completely
- remove sender track if needed
- release webcam resource
- notify peers

DO NOT just hide video element.

AUDIO ENABLE:
- request mic permission only when clicked
- enable audio track

AUDIO DISABLE:
- mute/disable audio track properly

==================================================
6. ADMIN REMOTE CONTROL
==================================================

Admin should see controls beside each participant:

- mute user
- unmute user
- disable user video
- enable user video

Admin actions must work in real-time.

Suggested events:

admin-force-video
admin-force-audio

Server flow:
- validate sender is admin
- forward action to target user
- target applies forced state

==================================================
7. FORCED MEDIA BEHAVIOR
==================================================

If admin disables user video:
- target camera must stop
- webcam resource released
- UI updates everywhere

If admin mutes user:
- target audio disabled immediately
- all peers updated

Users should visually know:
- when admin muted them
- when admin disabled camera

==================================================
8. SOCKET.IO STATE MANAGEMENT
==================================================

Maintain room state on server:

For each participant:
- socketId
- username
- role
- videoEnabled
- audioEnabled

Sync state:
- on join
- on reconnect
- on media toggle
- on admin actions

Suggested events:
- join-room
- room-state
- participant-joined
- participant-left
- participant-updated
- toggle-video
- toggle-audio
- admin-force-video
- admin-force-audio

==================================================
9. UI REQUIREMENTS
==================================================

Each participant card should show:
- username
- admin badge if admin
- avatar when camera off
- live video when camera on
- mic muted indicator
- connection state

When camera OFF:
- show initials avatar

When mic muted:
- show mute icon overlay

==================================================
10. WEBRTC REQUIREMENTS
==================================================

Implement proper:
- renegotiation
- ICE handling
- track replacement
- reconnect cleanup

Prevent:
- duplicate tracks
- stale streams
- memory leaks
- duplicate socket listeners

Handle:
- refresh
- reconnect
- user leave

==================================================
11. EDGE CASES
==================================================

Handle properly:

- user denies camera permission
- user denies mic permission
- admin leaves room
- reconnect after refresh
- multiple admins future compatibility
- browser tab close cleanup

Application should never crash.

==================================================
12. SECURITY REQUIREMENTS
==================================================

Server-side validation required for:
- admin actions
- room state updates
- participant permissions

Prevent:
- fake admin socket emits
- unauthorized media control
- direct role manipulation

==================================================
13. CODE QUALITY
==================================================

Requirements:
- modular implementation
- reusable functions
- proper cleanup
- comments where necessary
- no duplicated logic

Avoid:
- global mutable state
- inline giant socket handlers
- direct DOM hacks
- tightly coupled logic

==================================================
14. DELIVERABLES
==================================================

Modify existing project and provide:

- updated backend socket handlers
- updated frontend media handling
- admin moderation controls
- media synchronization logic
- UI updates
- cleanup handling

Do NOT generate unrelated boilerplate.
Work only on required files and functionality.
Keep implementation compatible with existing Express.js + Socket.IO + WebRTC architecture.