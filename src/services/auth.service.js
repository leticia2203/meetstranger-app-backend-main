// Importa a biblioteca jsonwebtoken para verificar e decodificar tokens JWT
const jwt = require('jsonwebtoken');

// FALLBACK JWT
const JWT_SECRET =
  process.env.JWT_SECRET ||
  'meetstranger-dev-secret';

// Importa o serviço de matching responsável por gerenciar filas e salas de conversa
const matchingService = require('./matching.service');

// Importa o serviço de autenticação para operações relacionadas ao usuário
const authService = require('./auth.service');

// Importa a função uuidv4 para geração de identificadores únicos universais
const { v4: uuidv4 } = require('uuid');

// Define a classe principal que encapsula toda a lógica do serviço WebSocket
class WebSocketService {

  // Construtor da classe
  constructor() {

    this.io = null;

    this.connectedUsers = new Map();
  }

  // =========================
  // INITIALIZE
  // =========================
  initialize(io) {

    this.io = io;

    io.on('connection', (socket) => {

      console.log(
        `🔌 User connected: ${socket.id}`
      );

      // =========================
      // AUTHENTICATE
      // =========================
      socket.on(
        'authenticate',
        async (data) => {

          console.log(
            `🔑 Authentication attempt: ${socket.id}`
          );

          try {

            const decoded = jwt.verify(
              data.token,
              JWT_SECRET
            );

            socket.userId = decoded.userId;

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
                userId: decoded.userId
              }
            );

            console.log(
              `✅ User authenticated: ${decoded.userId}`
            );

          } catch (error) {

            console.log(
              `❌ Auth failed:`,
              error.message
            );

            socket.emit(
              'auth_error',
              {
                message: 'Invalid token'
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
            `🔎 Finding match for user ${socket.userId}`
          );

          // NÃO AUTENTICADO
          if (!socket.userId) {

            socket.emit(
              'error',
              {
                message:
                  'Not authenticated'
              }
            );

            return;
          }

          // JÁ ESTÁ EM UMA SALA
          if (socket.currentRoom) {

            console.log(
              '⚠️ User already in room'
            );

            return;
          }

          const { category } = data;

          const allowedCategories = [
            'jogos',
            'series',
            'filmes',
            'games',
            'movies',
            'shows'
          ];

          if (
            !category ||
            !allowedCategories.includes(category)
          ) {

            socket.emit(
              'error',
              {
                message:
                  'Invalid category'
              }
            );

            return;
          }

          // MAP CATEGORIAS
          const categoryMap = {

            games: 'jogos',

            movies: 'filmes',

            shows: 'series'
          };

          const mappedCategory =
            categoryMap[category] ||
            category;

          // MATCHING
          const result =
            matchingService.joinQueue(
              socket.userId,
              socket.id,
              mappedCategory
            );

          console.log(
            '📊 Queue result:',
            result
          );

          // =========================
          // MATCH FOUND
          // =========================
          if (result.matched) {

            console.log(
              `🎯 Match found: ${result.roomId}`
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

            // SOCKET ATUAL
            socket.currentRoom =
              result.roomId;

            socket.join(
              result.roomId
            );

            socket.emit(
              'match-found',
              {
                roomId: result.roomId,

                category:
                  result.category,

                partner: {
                  username:
                    user2?.username ||
                    'Usuário'
                }
              }
            );

            // PARCEIRO
            if (partnerSocket) {

              partnerSocket.currentRoom =
                result.roomId;

              partnerSocket.join(
                result.roomId
              );

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

            // =========================
            // WAITING QUEUE
            // =========================
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
      // CANCEL MATCHING
      // =========================
      socket.on(
        'cancel-matching',
        () => {

          if (!socket.userId)
            return;

          matchingService.leaveAllQueues(
            socket.userId
          );

          socket.emit(
            'matching-cancelled',
            {
              success: true
            }
          );
        }
      );

      // =========================
      // JOIN ROOM
      // =========================
      socket.on(
        'join-room',
        (data) => {

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

            socket.emit(
              'room-joined',
              {
                roomId:
                  data.roomId
              }
            );

            console.log(
              `🏠 User ${socket.userId} joined room ${data.roomId}`
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

          if (
            !socket.currentRoom ||
            !socket.userId
          ) return;

          const sender =
            await authService.getUserById(
              socket.userId
            );

          const message = {

            id: uuidv4(),

            message: data.message,

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
            `🚪 Leaving room: ${data.roomId}`
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
            `❌ Disconnected: ${socket.id}`
          );

          if (socket.userId) {

            await authService.setUserOnline(
              socket.userId,
              false
            );

            matchingService.leaveAllQueues(
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

    if (!targetRoom)
      return;

    console.log(
      `🚪 Handling leave room: ${targetRoom}`
    );

    const roomData =
      matchingService.leaveRoom(
        targetRoom,
        socket.userId
      );

    if (roomData) {

      socket.to(
        targetRoom
      ).emit(
        'partner_left',
        {
          roomId: targetRoom,

          message:
            isDisconnect
              ? 'Parceiro desconectou'
              : 'Parceiro saiu'
        }
      );
    }

    socket.leave(targetRoom);

    socket.currentRoom = null;
  }

  // =========================
  // USERS COUNT
  // =========================
  getConnectedUsersCount() {

    return this.connectedUsers.size;
  }
}

module.exports =
  new WebSocketService();