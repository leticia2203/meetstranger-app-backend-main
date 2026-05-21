const { v4: uuidv4 } = require('uuid');

// Filas por categoria (em memória para P2P dinâmico)
const waitingQueues = {
  jogos: [],
  series: [],
  filmes: []
};

const activeRooms = new Map();

// Salas pendentes: criadas quando há um par, mas aguardando que ambos chamem join-room
const pendingRooms = new Map();

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

  // Procura parceiro válido
  const validPartnerIndex = queue.findIndex(
    item =>
      item.userId !== userId &&
      item.socketId !== socketId
  );

  // Se encontrou parceiro válido
  if (validPartnerIndex !== -1) {

    const partner =
      queue.splice(validPartnerIndex, 1)[0];

    const roomId = uuidv4();

    console.log(
      `🎯 Match found (pending)! Partner: ${partner.userId}, Room: ${roomId}`
    );

    // Cria sala pendente
    const pending = {
      id: roomId,
      category,
      user1Id: partner.userId,
      user2Id: userId,
      user1SocketId: partner.socketId,
      user2SocketId: socketId,
      status: 'pending',
      createdAt: new Date(),
      joined: new Set() // usuários que já chamaram join-room
    };

    pendingRooms.set(roomId, pending);

    console.log('🕐 Pending room created:', pending);

    return {
      matched: true,
      roomId,
      category,
      partnerId: partner.userId,
      partnerSocketId: partner.socketId
    };

  } else {

    // Verifica se usuário já está na fila
    const alreadyInQueue = queue.some(
      item =>
        item.userId === userId ||
        item.socketId === socketId
    );

    // Só adiciona se ainda não estiver
    if (!alreadyInQueue) {

      const queueItem = {

        userId,
        socketId,

        timestamp: Date.now()
      };

      queue.push(queueItem);

      console.log(
        `⏳ Added to queue. Position: ${queue.length}`
      );

    } else {

      console.log(
        `⚠️ User already in queue`
      );
    }

    return {

      matched: false,

      category,

      queuePosition: queue.length,

      estimatedWait:
        this.calculateEstimatedWait(
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

    // check active first
    if (activeRooms.has(roomId)) return activeRooms.get(roomId);

    // then pending
    if (pendingRooms.has(roomId)) return pendingRooms.get(roomId);

    return undefined;
  }

  getUserRoom(userId) {

    // search both active and pending
    const active = Array.from(activeRooms.values()).find(
      room => room.user1Id === userId || room.user2Id === userId
    );

    if (active) return active;

    return Array.from(pendingRooms.values()).find(
      room => room.user1Id === userId || room.user2Id === userId
    );
  }

  // MÉTODO QUE ESTAVA FALTANDO
  getUserRooms(userId) {

    const rooms = Array.from(activeRooms.values()).filter(
      room => room.user1Id === userId || room.user2Id === userId
    );

    const pending = Array.from(pendingRooms.values()).filter(
      room => room.user1Id === userId || room.user2Id === userId
    );

    return rooms.concat(pending);
  }

  leaveRoom(roomId, userId) {

    // try active rooms first
    const room = activeRooms.get(roomId);

    if (room) {
      activeRooms.delete(roomId);

      const partnerId = room.user1Id === userId ? room.user2Id : room.user1Id;

      const partnerSocketId =
        room.user1Id === userId ? room.user2SocketId : room.user1SocketId;

      console.log(`🚪 Room ${roomId} ended by user ${userId}`);

      return {
        ...room,
        partnerId,
        partnerSocketId,
        status: 'ended',
        endedAt: new Date()
      };
    }

    // if pending, remove and return ended
    const pending = pendingRooms.get(roomId);

    if (pending) {
      pendingRooms.delete(roomId);

      const partnerId = pending.user1Id === userId ? pending.user2Id : pending.user1Id;

      const partnerSocketId =
        pending.user1Id === userId ? pending.user2SocketId : pending.user1SocketId;

      console.log(`🚪 Pending room ${roomId} cancelled by user ${userId}`);

      return {
        ...pending,
        partnerId,
        partnerSocketId,
        status: 'cancelled',
        endedAt: new Date()
      };
    }

    return null;
  }

  // marca que um usuário chamou join-room para uma pending room
  markUserJoined(roomId, userId) {
    const pending = pendingRooms.get(roomId);

    if (!pending) return { finalized: false };

    pending.joined.add(userId);

    // se ambos chamaram join, finalize
    if (pending.joined.has(pending.user1Id) && pending.joined.has(pending.user2Id)) {
      // move to active
      const room = {
        id: pending.id,
        category: pending.category,
        user1Id: pending.user1Id,
        user2Id: pending.user2Id,
        user1SocketId: pending.user1SocketId,
        user2SocketId: pending.user2SocketId,
        status: 'active',
        createdAt: pending.createdAt
      };

      pendingRooms.delete(roomId);

      activeRooms.set(roomId, room);

      return { finalized: true, room };
    }

    return { finalized: false };
  }

  getPendingRoom(roomId) {
    return pendingRooms.get(roomId);
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

    // cleanup stale pending rooms (no finalization in 2 minutes)
    const now2 = Date.now();
    const maxPendingAge = 2 * 60 * 1000; // 2 minutes

    for (const [roomId, room] of pendingRooms.entries()) {
      if (now2 - room.createdAt.getTime() > maxPendingAge) {
        console.log(`🧹 Removing stale pending room: ${roomId}`);
        pendingRooms.delete(roomId);
      }
    }
  }
}

module.exports = new MatchingService();