import { defineConfig } from 'vitest/config';

// Varias pruebas juegan partidos completos: con la máquina cargada pasaban de los 5 s por defecto y fallaban por tiempo.
export default defineConfig({ test: { testTimeout: 30_000 } });
