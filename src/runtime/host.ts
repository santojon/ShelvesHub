// src/runtime/host.ts

export const HostApi = {
  lifecycle: {
    register() {
      console.log("Lifecycle registrado no HostApi.");
    },
  },
  rpc: {
    async call(method: string, args: any) {
      console.log(`[RPC] Chamando método: ${method}`);
      // Simula retorno de uma chamada RPC.
      return { data: "Simulação de retorno RPC" };
    },
  },
  platform: {
    getDetails() {
      console.log("Plataforma: Detalhes genéricos retornados.");
      return { os: "unknown", version: "0.0.1" };
    },
  },
};