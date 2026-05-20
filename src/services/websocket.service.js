const jwt = require('jsonwebtoken');

const matchingService = require('./matching.service');

const authService = require('./auth.service');

const { v4: uuidv4 } = require('uuid');

// =========================
// JWT FALLBACK
// =========================
const JWT_SECRET =
  process.env.JWT_SECRET ||
  'meetstranger-dev-secret';

class WebSocketService {

  constructor() {

    this.io = null;

    this.connectedUsers = new Map();
  }

  initialize(io) {

    this.io = io;

    io.on('connection', (socket) => {

      console.log(
        `🟢 User connected: ${socket.id}`
      );

      // =========================
      // AUTH
      // =========================
      socket.on(
        'authenticate',
        async (data) => {

          console.log(
            `🔑 Authentication attempt: ${socket.id}`
          );

          try {

            console.log(
              '📦 Token received:',
              data?.token
                ? 'YES'
                : 'NO'
            );

            console.log(
              '🔐 JWT_SECRET:',
              JWT_SECRET
            );

            if (!data?.token) {

              socket.emit(
                'auth_error',
                {
                  message:
                    'Token not provided'
                }
              );

              return;
            }

            const decoded =
              jwt.verify(
                data.token,
                JWT_SECRET
              );

            console.log(
              '✅ Token decoded:',
              decoded
            );

            socket.userId =
              decoded.userId;

            this.connectedUsers.set(
              decoded.userId,
              socket.id
            );

            await authService.setUserOnline(
              decoded.userId,
              true
            );

            socket.emit(
              'authenticated',
              {
                userId:
                  decoded.userId
              }
            );

            console.log(
              `✅ User authenticated: ${decoded.userId}`
            );

          } catch (error) {

            console.log(
              '❌ AUTH ERROR FULL:',
              error
            );

            socket.emit(
              'auth_error',
              {
                message:
                  error.message
              }
            );
          }
        }
      );

      // =========================
      // FIND MATCH
      // =========================
      socket.on(
        'find-match',
        async (data) => {

          console.log(
            '🔍 find-match called'
          );

          console.log(
            '👤 socket.userId:',
            socket.userId
          );

          console.log(
            '📦 data:',
            data
          );

          if (!socket.userId) {

            console.log(
              '❌ User not authenticated'
            );

            socket.emit(
              'error',
              {
                message:
                  'Not authenticated'
              }
            );

            return;
          }

          const { category } =
            data;

          const validCategories = [
            'jogos',
            'series',
            'filmes',
            'games',
            'movies',
            'shows'
          ];

          if (
            !category ||
            !validCategories.includes(
              category
            )
          ) {

            console.log(
              '❌ Invalid category:',
              category
            );

            socket.emit(
              'error',
              {
                message:
                  'Invalid category'
              }
            );

            return;
          }

          const categoryMap = {

            games: 'jogos',

            movies: 'filmes',

            shows: 'series'
          };

          const mappedCategory =
            categoryMap[category] ||
            category;

          console.log(
            '📂 Category mapped:',
            mappedCategory
          );

          const result =
            matchingService.joinQueue(
              socket.userId,
              socket.id,
              mappedCategory
            );

          console.log(
            '📊 Matching result:',
            result
          );

          // =========================
          // MATCH FOUND
          // =========================
          if (result.matched) {

            console.log(
              '🎯 MATCH FOUND'
            );

            const user1 =
              await authService.getUserById(
                socket.userId
              );

            const user2 =
              await authService.getUserById(
                result.partnerId
              );

            const partnerSocket =
              io.sockets.sockets.get(
                result.partnerSocketId
              );

            socket.emit(
              'match-found',
              {
                roomId:
                  result.roomId,

                category:
                  result.category,

                partner: {
                  username:
                    user2?.username ||
                    'Usuário'
                }
              }
            );

            if (partnerSocket) {

              partnerSocket.emit(
                'match-found',
                {
                  roomId:
                    result.roomId,

                  category:
                    result.category,

                  partner: {
                    username:
                      user1?.username ||
                      'Usuário'
                  }
                }
              );
            }

          } else {

            console.log(
              '⏳ User added to queue'
            );

            socket.emit(
              'queue-status',
              {
                category:
                  mappedCategory,

                position:
                  result.queuePosition,

                estimatedWait:
                  result.estimatedWait
              }
            );
          }
        }
      );

      // =========================
      // JOIN ROOM
      // =========================
      socket.on(
        'join-room',
        (data) => {

          console.log(
            '🚪 join-room:',
            data
          );

          const room =
            matchingService.getRoom(
              data.roomId
            );

          if (
            room &&
            (
              room.user1Id ===
                socket.userId ||
              room.user2Id ===
                socket.userId
            )
          ) {

            socket.join(
              data.roomId
            );

            socket.currentRoom =
              data.roomId;

            console.log(
              `✅ Joined room: ${data.roomId}`
            );

            socket.emit(
              'room-joined',
              {
                roomId:
                  data.roomId
              }
            );
          }
        }
      );

      // =========================
      // SEND MESSAGE
      // =========================
      socket.on(
        'send-message',
        async (data) => {

          console.log(
            '📩 send-message:',
            data
          );

          if (
            !socket.currentRoom ||
            !socket.userId
          ) {

            console.log(
              '❌ Cannot send message'
            );

            return;
          }

          const sender =
            await authService.getUserById(
              socket.userId
            );

          const message = {

            id: uuidv4(),

            message:
              data.message,

            senderId:
              socket.userId,

            timestamp:
              new Date()
          };

          socket.to(
            socket.currentRoom
          ).emit(
            'new-message',
            {
              id: message.id,

              message:
                message.message,

              username:
                sender?.username ||
                'Usuário',

              timestamp:
                message.timestamp
            }
          );
        }
      );

      // =========================
      // LEAVE ROOM
      // =========================
      socket.on(
        'leave-room',
        (data) => {

          console.log(
            '👋 leave-room:',
            data
          );

          this.handleLeaveRoom(
            socket,
            data.roomId
          );
        }
      );

      // =========================
      // DISCONNECT
      // =========================
      socket.on(
        'disconnect',
        async () => {

          console.log(
            `🔴 Disconnected: ${socket.id}`
          );

          if (socket.userId) {

            await authService.setUserOnline(
              socket.userId,
              false
            );

            matchingService.leaveQueue(
              socket.userId
            );

            this.connectedUsers.delete(
              socket.userId
            );

            this.handleLeaveRoom(
              socket,
              socket.currentRoom,
              true
            );
          }
        }
      );
    });

    // =========================
    // CLEANUP
    // =========================
    setInterval(() => {

      matchingService.cleanupInactiveRooms();

    }, 5 * 60 * 1000);
  }

  // =========================
  // HANDLE LEAVE ROOM
  // =========================
  handleLeaveRoom(
    socket,
    roomId = null,
    isDisconnect = false
  ) {

    const targetRoom =
      roomId ||
      socket.currentRoom;

    if (!targetRoom) return;

    console.log(
      '🚪 handleLeaveRoom:',
      targetRoom
    );

    matchingService.leaveRoom(
      targetRoom,
      socket.userId
    );

    socket.leave(targetRoom);

    socket.currentRoom = null;
  }

  // =========================
  // ONLINE USERS
  // =========================
  getConnectedUsersCount() {

    return this.connectedUsers.size;
  }
}

module.exports =
  new WebSocketService();