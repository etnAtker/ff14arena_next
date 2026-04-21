export interface SimulationConfig {
  tickRate: number;
}

export interface SimulationInstance {
  config: SimulationConfig;
  running: boolean;
  start(): void;
  stop(): void;
}

export function createSimulation(config: SimulationConfig): SimulationInstance {
  return {
    config,
    running: false,
    start() {
      this.running = true;
    },
    stop() {
      this.running = false;
    },
  };
}
