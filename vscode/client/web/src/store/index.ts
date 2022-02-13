import { createStore } from "vuex";

export default createStore({
  state: {
    A: 0,
    X: 0,
    Y: 0,
    SP: 0,
    PC: 0,
    P: 0,
    N: false,
    V: false,
    B: false,
    D: false,
    I: false,
    Z: false,
    C: false,
    Memory: "",
    MemoryViewer: "", // Memory viewer content with tag
    VicRegs: Array(47).fill(0), // VIC-II registers $D000-$D02E
    SpritePointers: Array(8).fill(0), // Sprite pointers $07F8-$07FF
    SpriteData: Array(8)
      .fill(null)
      .map(() => new Uint8Array(64)), // Individual sprite data
    ScreenMemory: new Uint8Array(1000), // Screen RAM $0400-$07E7
    ColorMemory: new Uint8Array(1000), // Color RAM $D800-$DBE7
    CharsetMemory: new Uint8Array(2048), // Character ROM/RAM $D000-$D7FF
  },
  getters: {
    A: (state) => state.A,
    X: (state) => state.X,
    Y: (state) => state.Y,
    SP: (state) => state.SP,
    PC: (state) => state.PC,
    flags: (state) => ({
      N: state.N,
      V: state.V,
      B: state.B,
      D: state.D,
      I: state.I,
      Z: state.Z,
      C: state.C,
    }),
  },
  mutations: {
    setRegisters(state, regs) {
      if (regs.A !== undefined) state.A = regs.A;
      if (regs.X !== undefined) state.X = regs.X;
      if (regs.Y !== undefined) state.Y = regs.Y;
      if (regs.SP !== undefined) state.SP = regs.SP;
      if (regs.PC !== undefined) state.PC = regs.PC;
      if (regs.P !== undefined) {
        state.P = regs.P;
        // Extract individual flags from P register
        state.N = !!(regs.P & 0x80);
        state.V = !!(regs.P & 0x40);
        state.B = !!(regs.P & 0x10);
        state.D = !!(regs.P & 0x08);
        state.I = !!(regs.P & 0x04);
        state.Z = !!(regs.P & 0x02);
        state.C = !!(regs.P & 0x01);
      }
    },
    setA(state, newA) {
      state.A = newA;
    },
    setMemory(state, newMemory) {
      state.Memory = newMemory;
    },
    setMemoryViewer(state, newMemory) {
      state.MemoryViewer = newMemory;
    },
    setVicRegs(state, regs) {
      state.VicRegs = regs;
    },
    setSpritePointers(state, pointers) {
      state.SpritePointers = pointers;
    },
    setSpriteData(state, payload: { index: number; data: Uint8Array }) {
      state.SpriteData[payload.index] =
        payload.data as typeof state.SpriteData[number];
    },
    setScreenMemory(state, memory) {
      state.ScreenMemory = memory;
    },
    setColorMemory(state, memory) {
      state.ColorMemory = memory;
    },
    setCharsetMemory(state, memory) {
      state.CharsetMemory = memory;
    },
  },
  actions: {},
  modules: {},
  plugins: [
    (store) => {
      // Handle the message inside the webview
      window.addEventListener("message", (event) => {
        const data = event.data; // The JSON data our extension sent

        // Handle debug stopped event - this is when we refresh all data
        if (data.type === "debugStopped" || (data.regs && data.invRegs)) {
          // When debugger stops, registers are sent automatically
          if (data.regs && data.invRegs) {
            const registers: any = {};

            // Map register names to values using invRegs lookup
            const regNames = ["A", "X", "Y", "SP", "PC", "P"];
            for (const name of regNames) {
              if (data.invRegs[name]) {
                const regId = data.invRegs[name].id;
                if (data.regs[regId]) {
                  registers[name] = data.regs[regId].value;
                }
              }
            }

            store.commit("setRegisters", registers);
          }
        }

        // Handle tagged memory responses
        if (data.tag === "memoryViewer" && data.memory) {
          store.commit("setMemoryViewer", data.memory);
        }
        if (data.tag === "vicRegs" && data.memory) {
          const bytes = parseMemoryHex(data.memory);
          store.commit("setVicRegs", bytes);
        }
        if (data.tag === "spritePointers" && data.memory) {
          const bytes = parseMemoryHex(data.memory);
          store.commit("setSpritePointers", bytes);
        }
        if (data.tag && data.tag.startsWith("spriteData:") && data.memory) {
          const index = parseInt(data.tag.split(":")[1]);
          if (!isNaN(index) && index >= 0 && index < 8) {
            const bytes = parseMemoryHex(data.memory);
            store.commit("setSpriteData", {
              index,
              data: new Uint8Array(bytes),
            });
          }
        }
        if (data.tag === "screenMemory" && data.memory) {
          const bytes = parseMemoryHex(data.memory);
          store.commit("setScreenMemory", new Uint8Array(bytes));
        }
        if (data.tag === "colorMemory" && data.memory) {
          const bytes = parseMemoryHex(data.memory);
          store.commit("setColorMemory", new Uint8Array(bytes));
        }
        if (data.tag === "charsetMemory" && data.memory) {
          const bytes = parseMemoryHex(data.memory);
          store.commit("setCharsetMemory", new Uint8Array(bytes));
        }
      });

      // Helper to parse hex memory string
      function parseMemoryHex(memStr: string): number[] {
        const bytes: number[] = [];
        if (memStr && typeof memStr === "string") {
          const cleaned = memStr.replace(/\s/g, "");
          for (let i = 0; i < cleaned.length; i += 2) {
            const byte = parseInt(cleaned.substr(i, 2), 16);
            if (!isNaN(byte)) {
              bytes.push(byte);
            }
          }
        }
        return bytes;
      }
    },
  ],
});
