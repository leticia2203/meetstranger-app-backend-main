const { v4: uuidv4 } = require('uuid');

// Filas por categoria (em memória para P2P dinâmico)
const waitingQueues = {
  jogos: [],
  series: [],
  filmes: []
};

const activeRooms = new Map();

class MatchingService {

  joinQueue(userId, socketId, category) {

    console.log(
      `📥 joinQueue called: userId=${userId}, category=${category}`
    );

    // Remove usuário de todas as filas anteriores
    this.leaveAllQueues(userId);

    // Verifica categoria
    const queue = waitingQueues[category];

    if (!queue) {

      console.log(`❌ Invalid category: ${category}`);

      throw new Error('Invalid category');
    }

    console.log(
      `📊 Current queue for ${category}:`,
      queue.length,
      'users waiting'
    );

    // Se já existe alguém esperando
    if (queue.length > 0) {

      const partner = queue.shift();

      const roomId = uuidv4();

      console.log(
        `🎯 Match found! Partner: ${partner.userId}, Room: ${roomId}`
      );

      // Cria sala
      const room = {
        id: roomId,
        category,

        user1Id: partner.userId,
        user2Id: userId,

        user1SocketId: partner.socketId,
        user2SocketId: socketId,

        status: 'active',

        createdAt: new Date()
      };

      activeRooms.set(roomId, room);

      console.log('🏠 Room created:', room);

      return {
        matched: true,

        roomId,

        category,

        partnerId: partner.userId,
        partnerSocketId: partner.socketId
      };

    } else {

      // Adiciona na fila
      const queueItem = {
        userId,
        socketId,
        timestamp: Date.now()
      };

      queue.push(queueItem);

      console.log(
        `⏳ Added to queue. Position: ${queue.length}`
      );

      return {
        matched: false,

        category,

        queuePosition: queue.length,

        estimatedWait: this.calculateEstimatedWait(
          queue.length
        )
      };
    }
  }

  leaveQueue(userId, category = null) {

    if (category) {

      const queue = waitingQueues[category];

      if (queue) {

        const index = queue.findIndex(
          item => item.userId === userId
        );

        if (index > -1) {

          queue.splice(index, 1);

          console.log(
            `🚪 User ${userId} removed from ${category} queue`
          );

          return true;
        }
      }

    } else {

      this.leaveAllQueues(userId);
    }

    return false;
  }

  leaveAllQueues(userId) {

    Object.keys(waitingQueues).forEach(category => {

      this.leaveQueue(userId, category);

    });
  }

  getRoom(roomId) {

    return activeRooms.get(roomId);
  }

  getUserRoom(userId) {

    return Array.from(activeRooms.values()).find(
      room =>
        room.user1Id === userId ||
        room.user2Id === userId
    );
  }

  // MÉTODO QUE ESTAVA FALTANDO
  getUserRooms(userId) {

    return Array.from(activeRooms.values()).filter(
      room =>
        room.user1Id === userId ||
        room.user2Id === userId
    );
  }

  leaveRoom(roomId, userId) {

    const room = activeRooms.get(roomId);

    if (room) {

      // Remove sala
      activeRooms.delete(roomId);

      // Descobre parceiro
      const partnerId =
        room.user1Id === userId
          ? room.user2Id
          : room.user1Id;

      const partnerSocketId =
        room.user1Id === userId
          ? room.user2SocketId
          : room.user1SocketId;

      console.log(
        `🚪 Room ${roomId} ended by user ${userId}`
      );

      return {
        ...room,

        partnerId,
        partnerSocketId,

        status: 'ended',

        endedAt: new Date()
      };
    }

    return null;
  }

  calculateEstimatedWait(queuePosition) {

    const avgWaitTime = 15; // segundos

    const estimatedSeconds =
      queuePosition * avgWaitTime;

    if (estimatedSeconds < 60) {

      return `${estimatedSeconds}s`;

    } else {

      return `${Math.ceil(
        estimatedSeconds / 60
      )}m`;
    }
  }

  getQueueStats() {

    return {
      jogos: waitingQueues.jogos.length,

      series: waitingQueues.series.length,

      filmes: waitingQueues.filmes.length,

      activeRooms: activeRooms.size
    };
  }

  // Cleanup automático
  cleanupInactiveRooms() {

    const now = Date.now();

    const maxInactiveTime =
      5 * 60 * 1000; // 5 minutos

    for (const [roomId, room] of activeRooms.entries()) {

      if (
        now - room.createdAt.getTime() >
        maxInactiveTime
      ) {

        console.log(
          `🧹 Removing inactive room: ${roomId}`
        );

        activeRooms.delete(roomId);
      }
    }
  }
}

module.exports = new MatchingService();