<template>
  <div class="registers">
    <CollapsibleTile title="Registers & Flags">
      <div class="register-line">
        <span class="line-label">Regs:</span>
        <span class="label">A</span>
        <input
          class="value editable"
          :value="formatHex(A, 2)"
          @blur="updateRegister('A', $event)"
          @keyup.enter="($event.target as HTMLInputElement).blur()"
        />
        <span class="label">X</span>
        <input
          class="value editable"
          :value="formatHex(X, 2)"
          @blur="updateRegister('X', $event)"
          @keyup.enter="($event.target as HTMLInputElement).blur()"
        />
        <span class="label">Y</span>
        <input
          class="value editable"
          :value="formatHex(Y, 2)"
          @blur="updateRegister('Y', $event)"
          @keyup.enter="($event.target as HTMLInputElement).blur()"
        />
        <span class="label">SP</span>
        <input
          class="value editable"
          :value="formatHex(SP, 2)"
          @blur="updateRegister('SP', $event)"
          @keyup.enter="($event.target as HTMLInputElement).blur()"
        />
        <span class="label">PC</span>
        <input
          class="value editable wide-input"
          :value="formatHex(PC, 4)"
          @blur="updateRegister('PC', $event)"
          @keyup.enter="($event.target as HTMLInputElement).blur()"
        />
      </div>
      <div class="flag-line">
        <span class="line-label">Flags:</span>
        <span :class="['flag', { active: N }]">N</span>
        <span :class="['flag', { active: V }]">V</span>
        <span :class="['flag', { active: B }]">B</span>
        <span :class="['flag', { active: D }]">D</span>
        <span :class="['flag', { active: I }]">I</span>
        <span :class="['flag', { active: Z }]">Z</span>
        <span :class="['flag', { active: C }]">C</span>
      </div>
    </CollapsibleTile>

    <CollapsibleTile title="Memory Viewer">
      <div class="memory-viewer">
        <div class="memory-controls">
          <label for="memOffset">Base Address:</label>
          <input
            id="memOffset"
            v-model="memoryOffset"
            type="text"
            placeholder="0000"
            @input="updateMemoryOffset"
          />
          <div class="memory-search-controls">
            <label for="memSearch">Search:</label>
            <input
              id="memSearch"
              v-model="searchQuery"
              type="text"
              placeholder="HEX (e.g., A9 20)"
              @input="updateSearchHighlight"
            />
            <span v-if="searchResults.length > 0" class="search-info">
              {{ searchResults.length }} match{{
                searchResults.length !== 1 ? "es" : ""
              }}
            </span>
          </div>
          <div class="memory-nav-buttons">
            <button
              @click="navigateMemory(-4096)"
              title="Back 4K (-$1000)"
              class="nav-btn"
            >
              ◀◀◀
            </button>
            <button
              @click="navigateMemory(-256)"
              title="Previous page (-$100)"
              class="nav-btn"
            >
              ◀◀
            </button>
            <button
              @click="navigateMemory(-16)"
              title="Back 16 bytes (-$10)"
              class="nav-btn"
            >
              ◀
            </button>
            <button
              @click="navigateMemory(16)"
              title="Forward 16 bytes (+$10)"
              class="nav-btn"
            >
              ▶
            </button>
            <button
              @click="navigateMemory(256)"
              title="Next page (+$100)"
              class="nav-btn"
            >
              ▶▶
            </button>
            <button
              @click="navigateMemory(4096)"
              title="Forward 4K (+$1000)"
              class="nav-btn"
            >
              ▶▶▶
            </button>
          </div>
        </div>
        <div class="memory-grid">
          <div class="memory-scroll-container">
            <div class="memory-header">
              <span class="addr-col">Address</span>
              <span class="hex-col">
                <span
                  v-for="(header, idx) in memoryHeaders"
                  :key="idx"
                  class="hex-header-byte"
                  >{{ header }}</span
                >
              </span>
              <span class="ascii-col">ASCII</span>
            </div>
            <div class="memory-rows">
              <div
                v-for="row in memoryRows"
                :key="row.address"
                class="memory-row"
              >
                <span class="addr-col">{{ formatHex(row.address, 4) }}</span>
                <span class="hex-col">
                  <input
                    v-for="(byte, idx) in row.bytes"
                    :key="idx"
                    class="byte editable-byte"
                    :class="{
                      changed: byte.changed,
                      found: byte.found,
                    }"
                    :value="formatByte(byte.value)"
                    @input="onMemoryByteInput(row.address + idx, $event)"
                    @blur="updateMemoryByte(row.address + idx, $event)"
                    @keyup.enter="($event.target as HTMLInputElement).blur()"
                    maxlength="2"
                  />
                </span>
                <span class="ascii-col">{{ row.ascii }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </CollapsibleTile>

    <CollapsibleTile title="Sprite Viewer">
      <div class="sprite-viewer">
        <div class="sprite-header-controls">
          <div class="sprite-scale-controls">
            <label>Scale:</label>
            <button @click="spriteScale = Math.max(1, spriteScale - 1)">
              −
            </button>
            <span class="scale-value">{{ spriteScale }}x</span>
            <button @click="spriteScale = Math.min(8, spriteScale + 1)">
              +
            </button>
          </div>
        </div>
        <div class="sprite-grid">
          <div
            v-for="(sprite, idx) in sprites"
            :key="idx"
            class="sprite-container"
          >
            <div class="sprite-header">
              <span class="sprite-label" :title="`Sprite ${idx}`"
                >S{{ idx }}</span
              >
              <span
                class="sprite-info"
                :title="`${
                  sprite.multicolor ? 'Multicolor' : 'Single color'
                } mode${sprite.expandX ? ', X-expanded' : ''}${
                  sprite.expandY ? ', Y-expanded' : ''
                }`"
                >{{ sprite.multicolor ? "MC" : "SC" }}
                {{ sprite.expandX ? "2X" : "" }}
                {{ sprite.expandY ? "2Y" : "" }}</span
              >
            </div>
            <div class="sprite-content">
              <canvas
                :ref="(el) => (spriteCanvasRefs[idx] = el)"
                class="sprite-canvas"
                :width="(sprite.expandX ? 48 : 24) * spriteScale"
                :height="(sprite.expandY ? 42 : 21) * spriteScale"
              ></canvas>
              <div class="sprite-regs">
                <div
                  class="reg-row"
                  title="X position (0-511, includes MSB from $D010)"
                >
                  <span class="reg-label">X:</span>
                  <span class="reg-value">{{ formatHex(sprite.x, 3) }}</span>
                </div>
                <div class="reg-row" title="Y position (0-255)">
                  <span class="reg-label">Y:</span>
                  <span class="reg-value">{{ formatHex(sprite.y, 2) }}</span>
                </div>
                <div
                  class="reg-row"
                  :title="`Color index: ${sprite.color} (VIC-II register $D027+${idx})`"
                >
                  <span class="reg-label">C:</span>
                  <span class="reg-value">{{
                    formatHex(sprite.color, 1)
                  }}</span>
                </div>
                <div
                  class="reg-row"
                  :title="`Sprite data pointer: ${
                    sprite.pointer
                  } → memory address ${formatHex(sprite.pointer * 64, 4)}`"
                >
                  <span class="reg-label">P:</span>
                  <span class="reg-value"
                    >{{ formatHex(sprite.pointer, 2) }}→{{
                      formatHex(sprite.pointer * 64, 4)
                    }}</span
                  >
                </div>
                <div
                  class="reg-row"
                  :title="
                    sprite.enabled
                      ? 'Sprite enabled ($D015 bit set)'
                      : 'Sprite disabled ($D015 bit clear)'
                  "
                >
                  <span class="reg-label">E:</span>
                  <span class="reg-value">{{
                    sprite.enabled ? "1" : "0"
                  }}</span>
                </div>
                <div
                  class="reg-row"
                  :title="
                    sprite.priority
                      ? 'Behind foreground (priority=1, $D01B)'
                      : 'In front of foreground (priority=0, $D01B)'
                  "
                >
                  <span class="reg-label">Z:</span>
                  <span class="reg-value">{{
                    sprite.priority ? "B" : "F"
                  }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </CollapsibleTile>

    <CollapsibleTile title="Screen Viewer">
      <div class="screen-viewer">
        <div class="screen-controls">
          <div class="control-row">
            <label for="screenSource">Source:</label>
            <select id="screenSource" v-model="screenSource">
              <option value="vic">VIC-II Auto</option>
              <option value="manual">Manual Address</option>
            </select>

            <label for="screenMode">Mode:</label>
            <select id="screenMode" v-model="screenMode">
              <option value="text-sc">Text Single Color</option>
              <option value="text-mc">Text Multicolor</option>
              <option value="bitmap-sc">Bitmap Single Color</option>
              <option value="bitmap-mc">Bitmap Multicolor</option>
            </select>
          </div>

          <div v-if="screenSource === 'manual'" class="control-row">
            <label for="screenAddr">Screen:</label>
            <input
              id="screenAddr"
              v-model="manualScreenAddr"
              placeholder="0400"
            />

            <label for="colorAddr">Color:</label>
            <input
              id="colorAddr"
              v-model="manualColorAddr"
              placeholder="D800"
            />

            <label for="charsetAddr">{{
              screenMode.startsWith("bitmap") ? "Bitmap:" : "Charset:"
            }}</label>
            <input
              id="charsetAddr"
              v-model="manualCharsetAddr"
              :placeholder="screenMode.startsWith('bitmap') ? '2000' : '1000'"
            />

            <button @click="refreshScreenData">Refresh</button>
          </div>
        </div>
        <canvas
          ref="screenCanvas"
          class="screen-canvas"
          width="320"
          height="200"
        ></canvas>
      </div>
    </CollapsibleTile>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  computed,
  ref,
  watch,
  onMounted,
  nextTick,
} from "vue";
import { useStore } from "vuex";
import CollapsibleTile from "./CollapsibleTile.vue";

declare global {
  function acquireVsCodeApi(): any;
}

export default defineComponent({
  name: "C64Registers",
  components: {
    CollapsibleTile,
  },
  setup(props) {
    const store = useStore();

    const vscode =
      typeof acquireVsCodeApi !== "undefined" ? acquireVsCodeApi() : null;

    const A = computed(() => store.state.A);
    const X = computed(() => store.state.X);
    const Y = computed(() => store.state.Y);
    const SP = computed(() => store.state.SP);
    const PC = computed(() => store.state.PC);
    const N = computed(() => store.state.N);
    const V = computed(() => store.state.V);
    const B = computed(() => store.state.B);
    const D = computed(() => store.state.D);
    const I = computed(() => store.state.I);
    const Z = computed(() => store.state.Z);
    const C = computed(() => store.state.C);

    const memoryOffset = ref("0000");
    const baseOffset = ref(0);
    const bytesPerRow = 16;
    const numRows = 16; // Show 16 rows (256 bytes total)

    const memory = computed(() => store.state.MemoryViewer);
    const previousMemory = ref<number[]>([]);
    const previousBaseOffset = ref(0);
    const isFirstLoad = ref(true);
    const searchQuery = ref("");
    const searchResults = ref<{ address: number; length: number }[]>([]);

    const formatHex = (value: number, digits: number): string => {
      return "$" + value.toString(16).toUpperCase().padStart(digits, "0");
    };

    const formatByte = (byte: number | undefined): string => {
      if (byte === undefined) return "??";
      return byte.toString(16).toUpperCase().padStart(2, "0");
    };

    const updateSearchHighlight = () => {
      searchResults.value = [];
      if (!searchQuery.value.trim()) return;

      try {
        const searchStr = searchQuery.value.replace(/\s/g, "").toUpperCase();
        if (searchStr.length % 2 !== 0) return;

        const searchBytes: number[] = [];
        for (let i = 0; i < searchStr.length; i += 2) {
          const byte = parseInt(searchStr.substr(i, 2), 16);
          if (isNaN(byte)) return;
          searchBytes.push(byte);
        }

        if (searchBytes.length === 0) return;

        const memStr = memory.value;
        let memBytes: number[] = [];
        if (memStr && typeof memStr === "string") {
          const cleaned = memStr.replace(/\s/g, "");
          for (let i = 0; i < cleaned.length; i += 2) {
            const byte = parseInt(cleaned.substr(i, 2), 16);
            if (!isNaN(byte)) {
              memBytes.push(byte);
            }
          }
        }

        for (let i = 0; i <= memBytes.length - searchBytes.length; i++) {
          let match = true;
          for (let j = 0; j < searchBytes.length; j++) {
            if (memBytes[i + j] !== searchBytes[j]) {
              match = false;
              break;
            }
          }
          if (match) {
            searchResults.value.push({
              address: baseOffset.value + i,
              length: searchBytes.length,
            });
          }
        }
      } catch (e) {
        // Invalid search
      }
    };

    const requestMemory = () => {
      if (vscode) {
        const start = baseOffset.value;
        const end = start + numRows * bytesPerRow - 1;
        vscode.postMessage({
          command: "getMemory",
          start: start,
          end: end,
          bankId: 0,
          tag: "memoryViewer",
        });
      }
    };

    const updateMemoryOffset = () => {
      try {
        let offset = memoryOffset.value.replace(/[$]/g, "");
        const parsed = parseInt(offset, 16);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 0xffff) {
          baseOffset.value = parsed;
          requestMemory();
        }
      } catch (e) {
        // Invalid input, ignore
      }
    };

    const navigateMemory = (delta: number) => {
      const newOffset = baseOffset.value + delta;
      if (newOffset >= 0 && newOffset <= 0xffff) {
        baseOffset.value = newOffset;
        memoryOffset.value = newOffset
          .toString(16)
          .toUpperCase()
          .padStart(4, "0");
        // Clear previous memory when changing base address
        previousMemory.value = [];
        previousBaseOffset.value = newOffset;
        requestMemory();
      }
    };

    const memoryRows = computed(() => {
      const rows = [];
      const memStr = memory.value;

      // Parse memory string if it exists (assuming hex string format)
      let memBytes: number[] = [];
      if (memStr && typeof memStr === "string") {
        // Try to parse as hex string (e.g., "01 02 03" or "010203")
        const cleaned = memStr.replace(/\s/g, "");
        for (let i = 0; i < cleaned.length; i += 2) {
          const byte = parseInt(cleaned.substr(i, 2), 16);
          if (!isNaN(byte)) {
            memBytes.push(byte);
          }
        }
      }

      for (let i = 0; i < numRows; i++) {
        const address = (baseOffset.value + i * bytesPerRow) & 0xffff;
        const bytes: {
          value: number | undefined;
          changed: boolean;
          found: boolean;
        }[] = [];
        let ascii = "";

        for (let j = 0; j < bytesPerRow; j++) {
          const memIndex = i * bytesPerRow + j;
          const byte = memBytes[memIndex];
          const previousByte = previousMemory.value[memIndex];
          // Only show changes if we're viewing the same base address
          const changed =
            baseOffset.value === previousBaseOffset.value &&
            byte !== undefined &&
            previousByte !== undefined &&
            byte !== previousByte;

          const byteAddress = baseOffset.value + memIndex;
          const found = searchResults.value.some(
            (result) =>
              byteAddress >= result.address &&
              byteAddress < result.address + result.length
          );

          bytes.push({
            value: byte,
            changed,
            found,
          });

          if (byte !== undefined) {
            const char =
              byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ".";
            ascii += char;
          } else {
            ascii += ".";
          }
        }

        rows.push({
          address,
          bytes,
          ascii,
        });
      }

      return rows;
    });

    const memoryHeaders = computed(() => {
      const headers = [];
      for (let i = 0; i < bytesPerRow; i++) {
        headers.push(formatHex((baseOffset.value + i) & 0xff, 2).substring(1));
      }
      return headers;
    });

    // Initialize base offset from input
    updateMemoryOffset();

    // Watch for memory changes to track differences
    watch(
      () => memory.value,
      (newMemory) => {
        if (newMemory && typeof newMemory === "string") {
          const cleaned = newMemory.replace(/\s/g, "");
          const newBytes: number[] = [];
          for (let i = 0; i < cleaned.length; i += 2) {
            const byte = parseInt(cleaned.substr(i, 2), 16);
            if (!isNaN(byte)) {
              newBytes.push(byte);
            }
          }

          // On first load, just set the baseline
          if (isFirstLoad.value) {
            previousMemory.value = newBytes.slice();
            previousBaseOffset.value = baseOffset.value;
            isFirstLoad.value = false;
          }
          // previousMemory stays as the OLD value until next update
          // This way changes persist until the next memory fetch
        }
      }
    );

    // Auto-refresh memory viewer on debug events (step, continue, etc.)
    // Watch PC register changes as indicator of debug stepping

    const updateRegister = (register: string, event: Event) => {
      const input = event.target as HTMLInputElement;
      let value = input.value.replace(/[$]/g, "").trim();

      try {
        const parsed = parseInt(value, 16);
        if (!isNaN(parsed)) {
          if (vscode) {
            vscode.postMessage({
              command: "setRegister",
              register: register,
              value: parsed,
            });
          }
        }
      } catch (e) {
        // Invalid input, revert
        input.value = formatHex(
          register === "A"
            ? A.value
            : register === "X"
            ? X.value
            : register === "Y"
            ? Y.value
            : register === "SP"
            ? SP.value
            : PC.value,
          register === "PC" ? 4 : 2
        );
      }
    };

    const onMemoryByteInput = (address: number, event: Event) => {
      const input = event.target as HTMLInputElement;
      const value = input.value.trim();

      if (value.length === 2) {
        const parsed = parseInt(value, 16);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 0xff) {
          const memIndex = address - baseOffset.value;
          if (memIndex >= 0 && memIndex < numRows * bytesPerRow) {
            const memStr = memory.value;
            if (memStr && typeof memStr === "string") {
              const cleaned = memStr.replace(/\s/g, "");
              if (memIndex * 2 + 2 <= cleaned.length) {
                const hexValue = parsed
                  .toString(16)
                  .toUpperCase()
                  .padStart(2, "0");
                const newMemStr =
                  cleaned.substring(0, memIndex * 2) +
                  hexValue +
                  cleaned.substring(memIndex * 2 + 2);
                store.commit("setMemoryViewer", newMemStr);
              }
            }
          }
        }
      }
    };

    const updateMemoryByte = (address: number, event: Event) => {
      const input = event.target as HTMLInputElement;
      const value = input.value.trim();

      try {
        const parsed = parseInt(value, 16);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 0xff) {
          if (vscode) {
            vscode.postMessage({
              command: "setMemory",
              address: address,
              value: parsed,
            });
            // Refresh all views after memory update
            requestSpriteData();
            if (screenSource.value === "manual") {
              refreshScreenData();
            }
            requestMemory();
          }
        } else {
          // Invalid value, request memory refresh to restore original
          requestMemory();
        }
      } catch (e) {
        // Invalid input, request memory refresh to restore original
        requestMemory();
      }
    };

    // Sprite viewer functionality - reads from VIC-II and C64 memory
    const spriteCanvasRefs = ref<any[]>([]);
    const spriteScale = ref(3); // Default 3x scale
    const screenCanvas = ref<HTMLCanvasElement | null>(null);

    // Screen viewer controls
    const screenSource = ref<"vic" | "manual">("vic");
    const screenMode = ref<"text-sc" | "text-mc" | "bitmap-sc" | "bitmap-mc">(
      "text-sc"
    );
    const manualScreenAddr = ref("0400");
    const manualColorAddr = ref("D800");
    const manualCharsetAddr = ref("1000");

    // VIC-II registers and sprite memory from store
    const vicRegs = computed(() => store.state.VicRegs || Array(47).fill(0)); // $D000-$D02E
    const spritePointersFromStore = computed(
      () => store.state.SpritePointers || Array(8).fill(0)
    ); // $07F8-$07FF

    // Individual sprite data
    const spriteDataFromStore = computed(
      () =>
        store.state.SpriteData ||
        Array(8)
          .fill(null)
          .map(() => new Uint8Array(64))
    );

    const screenMemoryFromStore = computed(
      () => store.state.ScreenMemory || new Uint8Array(1000)
    ); // Screen RAM (40x25 = 1000 bytes)
    const colorMemoryFromStore = computed(
      () => store.state.ColorMemory || new Uint8Array(1000)
    ); // Color RAM (40x25 = 1000 bytes)
    const charsetMemoryFromStore = computed(
      () => store.state.CharsetMemory || new Uint8Array(2048)
    ); // Character ROM/RAM (256 chars × 8 bytes)

    // Parse VIC-II sprite registers
    const spriteMulticolor = computed(() => {
      const d01c = vicRegs.value[0x1c] || 0;
      return Array(8)
        .fill(null)
        .map((_, i) => ((d01c >> i) & 1) === 1);
    });

    const spriteExpandX = computed(() => {
      const d01d = vicRegs.value[0x1d] || 0;
      return Array(8)
        .fill(null)
        .map((_, i) => ((d01d >> i) & 1) === 1);
    });

    const spriteExpandY = computed(() => {
      const d017 = vicRegs.value[0x17] || 0;
      return Array(8)
        .fill(null)
        .map((_, i) => ((d017 >> i) & 1) === 1);
    });

    const spriteColors = computed(() => {
      // $D027-$D02E (39-46 in VIC registers)
      return Array(8)
        .fill(null)
        .map((_, i) => vicRegs.value[0x27 + i] || 1);
    });

    const backgroundColor = computed(() => vicRegs.value[0x21] || 0); // $D021
    const spriteMulticolor1 = computed(() => vicRegs.value[0x25] || 0); // $D025
    const spriteMulticolor2 = computed(() => vicRegs.value[0x26] || 0); // $D026

    const spriteData = computed(() => {
      return Array(8)
        .fill(null)
        .map((_, idx) => {
          const data = spriteDataFromStore.value[idx];
          return data ? Array.from(data) : Array(64).fill(0);
        });
    });

    const sprites = computed(() => {
      const d015 = vicRegs.value[0x15] || 0; // Sprite enable
      const d01b = vicRegs.value[0x1b] || 0; // Sprite priority
      const d010 = vicRegs.value[0x10] || 0; // Sprite X MSB

      return Array(8)
        .fill(null)
        .map((_, idx) => {
          const xLow = vicRegs.value[idx * 2] || 0; // $D000, $D002, etc.
          const xHigh = ((d010 >> idx) & 1) << 8;
          const x = xLow | xHigh;
          const y = vicRegs.value[idx * 2 + 1] || 0; // $D001, $D003, etc.

          return {
            multicolor: spriteMulticolor.value[idx],
            expandX: spriteExpandX.value[idx],
            expandY: spriteExpandY.value[idx],
            data: spriteData.value[idx],
            color: spriteColors.value[idx],
            x: x,
            y: y,
            pointer: spritePointersFromStore.value[idx],
            enabled: ((d015 >> idx) & 1) === 1,
            priority: ((d01b >> idx) & 1) === 1, // 1=behind, 0=in front
          };
        });
    });

    // C64 color palette (simplified)
    const c64Colors = [
      "#000000",
      "#ffffff",
      "#880000",
      "#aaffee",
      "#cc44cc",
      "#00cc55",
      "#0000aa",
      "#eeee77",
      "#dd8855",
      "#664400",
      "#ff7777",
      "#333333",
      "#777777",
      "#aaff66",
      "#0088ff",
      "#bbbbbb",
    ];

    // Compute average luminance of sprite colors to choose contrasting background
    const getContrastingBackground = (spriteIndex: number): string => {
      const sprite = sprites.value[spriteIndex];
      const usedColors: Set<number> = new Set();

      // Collect all colors used in this sprite
      if (sprite.multicolor) {
        usedColors.add(spriteMulticolor1.value & 0x0f);
        usedColors.add(sprite.color & 0x0f);
        usedColors.add(spriteMulticolor2.value & 0x0f);
      } else {
        usedColors.add(sprite.color & 0x0f);
      }

      // Calculate average luminance
      let totalLuminance = 0;
      let count = 0;

      usedColors.forEach((colorIdx) => {
        const color = c64Colors[colorIdx];
        // Parse hex color to get RGB
        const r = parseInt(color.substr(1, 2), 16);
        const g = parseInt(color.substr(3, 2), 16);
        const b = parseInt(color.substr(5, 2), 16);
        // Calculate relative luminance
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        totalLuminance += luminance;
        count++;
      });

      const avgLuminance = totalLuminance / count;

      // If sprite uses mostly dark colors, use light background
      // If sprite uses mostly light colors, use dark background
      if (avgLuminance > 0.5) {
        return "#1a1a2e"; // Dark blue-gray
      } else {
        return "#3a3a4e"; // Medium blue-gray
      }
    };

    const renderSprite = (
      ctx: CanvasRenderingContext2D,
      spriteIndex: number
    ) => {
      const sprite = sprites.value[spriteIndex];
      const data = sprite.data;
      const scale = spriteScale.value;
      const width = (sprite.expandX ? 48 : 24) * scale;
      const height = (sprite.expandY ? 42 : 21) * scale;
      const pixelWidth = (sprite.expandX ? 2 : 1) * scale;
      const pixelHeight = (sprite.expandY ? 2 : 1) * scale;

      // Fill with contrasting background color
      ctx.fillStyle = getContrastingBackground(spriteIndex);
      ctx.fillRect(0, 0, width, height);

      // Render sprite pixels
      for (let y = 0; y < 21; y++) {
        const rowOffset = y * 3;
        const byte0 = data[rowOffset] || 0;
        const byte1 = data[rowOffset + 1] || 0;
        const byte2 = data[rowOffset + 2] || 0;

        if (sprite.multicolor) {
          // Multicolor mode: 2 bits per pixel, 12 pixels per row
          for (let x = 0; x < 12; x++) {
            const byteIndex = Math.floor(x / 4);
            const bitPairIndex = x % 4;
            const bitOffset = 6 - bitPairIndex * 2; // Bit pairs 7-6, 5-4, 3-2, 1-0

            let byte =
              byteIndex === 0 ? byte0 : byteIndex === 1 ? byte1 : byte2;
            const pixelValue = (byte >> bitOffset) & 0x03;

            let color = "";
            switch (pixelValue) {
              case 0:
                color = "transparent"; // Background
                break;
              case 1:
                color = c64Colors[spriteMulticolor1.value & 0x0f] || "#fff";
                break;
              case 2:
                color = c64Colors[sprite.color & 0x0f] || "#fff";
                break;
              case 3:
                color = c64Colors[spriteMulticolor2.value & 0x0f] || "#fff";
                break;
            }

            if (color !== "transparent") {
              ctx.fillStyle = color;
              const drawX = x * 2 * pixelWidth;
              const drawY = y * pixelHeight;
              ctx.fillRect(drawX, drawY, 2 * pixelWidth, pixelHeight);
            }
          }
        } else {
          // Single color mode: 1 bit per pixel, 24 pixels per row
          for (let x = 0; x < 24; x++) {
            const byteIndex = Math.floor(x / 8);
            const bitOffset = 7 - (x % 8); // Bit 7 is leftmost pixel

            let byte =
              byteIndex === 0 ? byte0 : byteIndex === 1 ? byte1 : byte2;
            const pixelValue = (byte >> bitOffset) & 1;

            if (pixelValue === 1) {
              ctx.fillStyle = c64Colors[sprite.color & 0x0f] || "#fff";
              const drawX = x * pixelWidth;
              const drawY = y * pixelHeight;
              ctx.fillRect(drawX, drawY, pixelWidth, pixelHeight);
            }
          }
        }
      }
    };

    const updateSpriteCanvases = () => {
      nextTick(() => {
        spriteCanvasRefs.value.forEach((canvas, idx) => {
          if (canvas) {
            const ctx = canvas.getContext("2d");
            if (ctx) {
              renderSprite(ctx, idx);
            }
          }
        });
      });
    };

    // Watch for changes to sprite data or scale
    watch(
      [spriteData, spriteMulticolor, spriteExpandX, spriteExpandY, spriteScale],
      () => {
        updateSpriteCanvases();
      },
      { deep: true }
    );

    // C64 screen viewer - renders 40x25 character screen
    const renderScreen = () => {
      if (!screenCanvas.value) return;

      const ctx = screenCanvas.value.getContext("2d");
      if (!ctx) return;

      const screenMem = screenMemoryFromStore.value;
      const colorMem = colorMemoryFromStore.value;
      const charMem = charsetMemoryFromStore.value;
      const bgColor = backgroundColor.value;
      const mode = screenMode.value;

      console.log("renderScreen called", {
        mode,
        screenMemLen: screenMem.length,
        colorMemLen: colorMem.length,
        charMemLen: charMem.length,
        bgColor,
        firstScreenBytes: Array.from(screenMem.slice(0, 10)),
        firstColorBytes: Array.from(colorMem.slice(0, 10)),
        firstCharBytes: Array.from(charMem.slice(0, 16)),
      });

      // Clear screen with background color
      ctx.fillStyle = c64Colors[bgColor & 0x0f];
      ctx.fillRect(0, 0, 320, 200);

      if (mode === "text-sc") {
        // Text mode, single color
        for (let row = 0; row < 25; row++) {
          for (let col = 0; col < 40; col++) {
            const screenOffset = row * 40 + col;
            const charCode = screenMem[screenOffset] || 0;
            const color = colorMem[screenOffset] || 1;
            const charOffset = charCode * 8;

            for (let charRow = 0; charRow < 8; charRow++) {
              const charByte = charMem[charOffset + charRow] || 0;
              for (let charCol = 0; charCol < 8; charCol++) {
                const bit = (charByte >> (7 - charCol)) & 1;
                if (bit) {
                  ctx.fillStyle = c64Colors[color & 0x0f];
                  ctx.fillRect(col * 8 + charCol, row * 8 + charRow, 1, 1);
                }
              }
            }
          }
        }
      } else if (mode === "text-mc") {
        // Text mode, multicolor
        const mc1 = vicRegs.value[0x22] || 0; // $D022
        const mc2 = vicRegs.value[0x23] || 0; // $D023

        for (let row = 0; row < 25; row++) {
          for (let col = 0; col < 40; col++) {
            const screenOffset = row * 40 + col;
            const charCode = screenMem[screenOffset] || 0;
            const colorCode = colorMem[screenOffset] || 1;
            const charOffset = charCode * 8;
            const isMulticolor = colorCode >= 8; // Bit 3 set = multicolor

            for (let charRow = 0; charRow < 8; charRow++) {
              const charByte = charMem[charOffset + charRow] || 0;

              if (isMulticolor) {
                // Multicolor: 2 bits per pixel, 4 pixel pairs per row
                // Use only bits 0-2 of color RAM for the character color
                const mcCharColor = colorCode & 0x07;
                for (let pixelPair = 0; pixelPair < 4; pixelPair++) {
                  const bitPair = (charByte >> (6 - pixelPair * 2)) & 0x03;
                  let color;
                  switch (bitPair) {
                    case 0:
                      color = bgColor;
                      break;
                    case 1:
                      color = mc1;
                      break;
                    case 2:
                      color = mc2;
                      break;
                    case 3:
                      color = mcCharColor;
                      break;
                  }
                  ctx.fillStyle = c64Colors[color & 0x0f];
                  ctx.fillRect(
                    col * 8 + pixelPair * 2,
                    row * 8 + charRow,
                    2,
                    1
                  );
                }
              } else {
                // Single color: use all 4 bits of color RAM
                const fgColor = colorCode & 0x0f;
                for (let charCol = 0; charCol < 8; charCol++) {
                  const bit = (charByte >> (7 - charCol)) & 1;
                  if (bit) {
                    ctx.fillStyle = c64Colors[fgColor];
                    ctx.fillRect(col * 8 + charCol, row * 8 + charRow, 1, 1);
                  }
                }
              }
            }
          }
        }
      } else if (mode === "bitmap-sc") {
        // Bitmap mode, single color (320x200)
        for (let y = 0; y < 200; y++) {
          const charRow = Math.floor(y / 8);
          const pixelRow = y % 8;

          for (let x = 0; x < 40; x++) {
            const screenOffset = charRow * 40 + x;
            const colorByte = screenMem[screenOffset] || 0;
            const fgColor = (colorByte >> 4) & 0x0f;
            const bgColorLocal = colorByte & 0x0f;

            const bitmapOffset = charRow * 320 + x * 8 + pixelRow;
            const bitmapByte = charMem[bitmapOffset] || 0;

            for (let bit = 0; bit < 8; bit++) {
              const pixel = (bitmapByte >> (7 - bit)) & 1;
              ctx.fillStyle = c64Colors[pixel ? fgColor : bgColorLocal];
              ctx.fillRect(x * 8 + bit, y, 1, 1);
            }
          }
        }
      } else if (mode === "bitmap-mc") {
        // Bitmap mode, multicolor
        const mc1 = vicRegs.value[0x22] || 0; // $D022 (background 1)
        const mc2 = vicRegs.value[0x23] || 0; // $D023 (background 2)

        for (let y = 0; y < 200; y++) {
          const charRow = Math.floor(y / 8);
          const pixelRow = y % 8;

          for (let x = 0; x < 40; x++) {
            const screenOffset = charRow * 40 + x;
            const colorByte = screenMem[screenOffset] || 0;
            const colorNibbleHigh = (colorByte >> 4) & 0x0f;

            const colorOffset = charRow * 40 + x;
            const colorNibbleLow = colorMem[colorOffset] & 0x0f;

            const bitmapOffset = charRow * 320 + x * 8 + pixelRow;
            const bitmapByte = charMem[bitmapOffset] || 0;

            // 4 pixel pairs per byte (2 bits each)
            for (let pixelPair = 0; pixelPair < 4; pixelPair++) {
              const bitPair = (bitmapByte >> (6 - pixelPair * 2)) & 0x03;
              let color;
              switch (bitPair) {
                case 0:
                  color = bgColor;
                  break;
                case 1:
                  color = colorNibbleHigh;
                  break;
                case 2:
                  color = colorNibbleLow;
                  break;
                case 3:
                  color = mc2;
                  break;
              }
              ctx.fillStyle = c64Colors[color & 0x0f];
              ctx.fillRect(x * 8 + pixelPair * 2, y, 2, 1);
            }
          }
        }
      }
    };

    // Watch for changes to screen data or mode
    watch(
      [
        screenMemoryFromStore,
        colorMemoryFromStore,
        charsetMemoryFromStore,
        backgroundColor,
        screenMode,
      ],
      () => {
        renderScreen();
      },
      { deep: true }
    );

    // Refresh screen data with manual addresses
    const refreshScreenData = () => {
      if (!vscode || screenSource.value !== "manual") return;

      try {
        const screenAddr = parseInt(
          manualScreenAddr.value.replace(/[$]/g, ""),
          16
        );
        const colorAddr = parseInt(
          manualColorAddr.value.replace(/[$]/g, ""),
          16
        );
        const charsetAddr = parseInt(
          manualCharsetAddr.value.replace(/[$]/g, ""),
          16
        );

        if (screenMode.value.startsWith("text")) {
          // Text mode: screen = 1000 bytes, charset = 2048 bytes
          vscode.postMessage({
            command: "getMemory",
            start: screenAddr,
            end: screenAddr + 999,
            bankId: 0,
            tag: "screenMemory",
          });
          vscode.postMessage({
            command: "getMemory",
            start: colorAddr,
            end: colorAddr + 999,
            bankId: 0,
            tag: "colorMemory",
          });
          vscode.postMessage({
            command: "getMemory",
            start: charsetAddr,
            end: charsetAddr + 2047,
            bankId: 0,
            tag: "charsetMemory",
          });
        } else {
          // Bitmap mode: screen = 1000 bytes (color info), bitmap = 8000 bytes
          vscode.postMessage({
            command: "getMemory",
            start: screenAddr,
            end: screenAddr + 999,
            bankId: 0,
            tag: "screenMemory",
          });
          vscode.postMessage({
            command: "getMemory",
            start: colorAddr,
            end: colorAddr + 999,
            bankId: 0,
            tag: "colorMemory",
          });
          vscode.postMessage({
            command: "getMemory",
            start: charsetAddr,
            end: charsetAddr + 7999,
            bankId: 0,
            tag: "charsetMemory",
          });
        }
      } catch (e) {
        console.error("Invalid address format", e);
      }
    };

    // Watch sprite pointers to fetch sprite data
    watch(
      () => spritePointersFromStore.value,
      (newPointers) => {
        if (vscode && newPointers && newPointers.length > 0) {
          newPointers.forEach((ptr: number, idx: number) => {
            const addr = ptr * 64;
            vscode.postMessage({
              command: "getMemory",
              start: addr,
              end: addr + 63,
              bankId: 0,
              tag: `spriteData:${idx}`,
            });
          });
        }
      },
      { deep: true, immediate: true }
    );

    // Request VIC-II registers and sprite data from debugger
    const requestSpriteData = () => {
      if (vscode) {
        // Request VIC-II registers ($D000-$D02E)
        vscode.postMessage({
          command: "getMemory",
          start: 0xd000,
          end: 0xd02e,
          bankId: 0,
          tag: "vicRegs",
        });

        // Request sprite pointers ($07F8-$07FF in current video bank)
        // For simplicity, assume default screen at $0400, pointers at $07F8
        vscode.postMessage({
          command: "getMemory",
          start: 0x07f8,
          end: 0x07ff,
          bankId: 0,
          tag: "spritePointers",
        });

        // Also buffer the screen memory request (already there)

        // Request screen memory (default at $0400, 40×25 = 1000 bytes)
        vscode.postMessage({
          command: "getMemory",
          start: 0x0400,
          end: 0x07e7,
          bankId: 0,
          tag: "screenMemory",
        });

        // Request color memory ($D800-$DBE7, 1000 bytes)
        vscode.postMessage({
          command: "getMemory",
          start: 0xd800,
          end: 0xdbe7,
          bankId: 0,
          tag: "colorMemory",
        });

        // Request character ROM (default charset at $D000-$DFFF in character ROM)
        // For simplicity, request the uppercase/graphics charset (first 256 chars)
        vscode.postMessage({
          command: "getMemory",
          start: 0xd000,
          end: 0xd7ff,
          bankId: 0,
          tag: "charsetMemory",
        });
      }
    };

    // Auto-refresh memory viewer on debug events (step, continue, etc.)
    // Watch PC register changes as indicator of debug stepping
    watch(
      () => PC.value,
      () => {
        // Before requesting new memory, update previousMemory with current memory
        // This creates the baseline for the next comparison
        const memStr = memory.value;
        if (memStr && typeof memStr === "string" && !isFirstLoad.value) {
          const cleaned = memStr.replace(/\s/g, "");
          const currentBytes: number[] = [];
          for (let i = 0; i < cleaned.length; i += 2) {
            const byte = parseInt(cleaned.substr(i, 2), 16);
            if (!isNaN(byte)) {
              currentBytes.push(byte);
            }
          }
          previousMemory.value = currentBytes.slice();
          previousBaseOffset.value = baseOffset.value;
        }
        // Now fetch new memory which will be compared against this baseline
        requestMemory();
        requestSpriteData();
        refreshScreenData();
      }
    );

    onMounted(() => {
      updateSpriteCanvases();
      renderScreen();
    });

    return {
      A,
      X,
      Y,
      SP,
      PC,
      N,
      V,
      B,
      D,
      I,
      Z,
      C,
      formatHex,
      formatByte,
      memoryOffset,
      memoryHeaders,
      memoryRows,
      updateMemoryOffset,
      navigateMemory,
      searchQuery,
      searchResults,
      updateSearchHighlight,
      updateRegister,
      onMemoryByteInput,
      updateMemoryByte,
      sprites,
      spriteCanvasRefs,
      spriteScale,
      screenCanvas,
      screenSource,
      screenMode,
      manualScreenAddr,
      manualColorAddr,
      manualCharsetAddr,
      refreshScreenData,
    };
  },
});
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
.registers {
  padding: 0px;
  background: #1e1e1e;
  color: #d4d4d4;
  font-family: var(--vscode-editor-font-family);
  font-size: 13px;
}

.register-line,
.flag-line {
  display: flex;
  align-items: center;
  gap: 4px;
  background: #1e1e1e;
  padding: 0px;
  border-radius: 3px;
  margin-bottom: 2px;
}

.line-label {
  color: #4ec9b0;
  font-weight: bold;
  margin-right: 4px;
  font-size: 13px;
}

.label {
  color: #569cd6;
  font-size: 13px;
  margin-left: 2px;
}

.value {
  color: #b5cea8;
  font-size: 13px;
}

.value.editable {
  background: transparent;
  border: 1px solid transparent;
  color: #b5cea8;
  font-family: var(--vscode-editor-font-family);
  font-size: 13px;
  padding: 0;
  width: 40px;
  text-align: center;
}

.value.editable.wide-input {
  width: 60px;
}

.value.editable:hover {
  border-color: #3e3e42;
  background: #252526;
}

.value.editable:focus {
  outline: none;
  border-color: #4ec9b0;
  background: #252526;
}

.flag {
  display: inline-block;
  width: 16px;
  height: 16px;
  line-height: 16px;
  text-align: center;
  background: #252526;
  border-radius: 2px;
  font-weight: bold;
  font-size: 12px;
  color: #6a6a6a;
  transition: all 0.2s ease;
}

.flag.active {
  background: #4ec9b0;
  color: #1e1e1e;
  box-shadow: 0 0 6px rgba(78, 201, 176, 0.4);
}

.memory-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
}

.memory-controls label {
  color: #569cd6;
  font-weight: bold;
  font-size: 13px;
}

.memory-controls input {
  background: #2d2d30;
  border: 1px solid #3e3e42;
  color: #d4d4d4;
  padding: 1px 4px;
  border-radius: 3px;
  font-family: var(--vscode-editor-font-family);
  font-size: 13px;
  width: 70px;
}

.memory-controls input:focus {
  outline: none;
  border-color: #4ec9b0;
}

.memory-nav-buttons {
  display: flex;
  gap: 2px;
  margin-left: 4px;
}

.memory-nav-buttons .nav-btn {
  background: #2d2d30;
  border: 1px solid #3e3e42;
  color: #d4d4d4;
  padding: 1px 6px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s ease;
  min-width: 24px;
}

.memory-nav-buttons .nav-btn:hover {
  background: #37373d;
  border-color: #4ec9b0;
}

.memory-nav-buttons .nav-btn:active {
  background: #1e1e1e;
}

.memory-grid {
  background: #1e1e1e;
  border-radius: 3px;
  padding: 2px;
  border: 1px solid #3e3e42;
}

.memory-scroll-container {
  overflow-x: auto;
  overflow-y: auto;
  max-height: 350px;
}

.memory-header {
  display: flex;
  gap: 4px;
  padding: 2px 0;
  border-bottom: 1px solid #3e3e42;
  margin-bottom: 2px;
  color: #569cd6;
  font-weight: bold;
  font-size: 12px;
  position: sticky;
  top: 0;
  background: #1e1e1e;
  z-index: 1;
  min-width: max-content;
}

.memory-row {
  display: flex;
  gap: 4px;
  padding: 0;
  font-size: 12px;
  min-width: max-content;
}

.memory-row:hover {
  background: #37373d;
}

.addr-col {
  color: #569cd6;
  width: 60px;
  flex-shrink: 0;
}

.hex-col {
  display: flex;
  gap: 1px;
  flex: 1;
  font-family: var(--vscode-editor-font-family);
}

.byte {
  color: #b5cea8;
  min-width: 18px;
}

.editable-byte {
  background: transparent;
  border: 1px solid transparent;
  box-sizing: border-box;
  color: #b5cea8;
  font-family: var(--vscode-editor-font-family);
  font-size: 12px;
  padding: 0;
  width: 22px;
  flex-shrink: 0;
  text-align: center;
  text-transform: uppercase;
}

.editable-byte:hover {
  border-color: #3e3e42;
  background: #252526;
}

.editable-byte:focus {
  outline: none;
  border-color: #4ec9b0;
  background: #252526;
}

.editable-byte.changed {
  background: #334d33;
  border-color: #4ec9b0;
  color: #90ee90;
  font-weight: bold;
}

.editable-byte.changed:focus {
  background: #3a5a3a;
  box-shadow: 0 0 6px rgba(144, 238, 144, 0.5);
}

.editable-byte.found {
  background: #4d334d;
  border-color: #f94c4c;
  color: #ffb3ff;
  font-weight: bold;
}

.editable-byte.found:focus {
  background: #5a3a5a;
  box-shadow: 0 0 6px rgba(249, 76, 76, 0.5);
}

.editable-byte.changed.found {
  background: #5a4d3a;
  border-color: #ffd700;
  color: #ffffaa;
}

.editable-byte.changed.found:focus {
  background: #6a5d4a;
  box-shadow: 0 0 6px rgba(255, 215, 0, 0.5);
}

.memory-search-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  margin-left: 8px;
}

.memory-search-controls label {
  color: #569cd6;
  font-weight: bold;
  font-size: 13px;
  white-space: nowrap;
}

.memory-search-controls input {
  background: #2d2d30;
  border: 1px solid #3e3e42;
  color: #d4d4d4;
  padding: 1px 4px;
  border-radius: 3px;
  font-family: var(--vscode-editor-font-family);
  font-size: 13px;
  flex: 1;
  min-width: 150px;
  max-width: 250px;
}

.memory-search-controls input:focus {
  outline: none;
  border-color: #4ec9b0;
  background: #252526;
}

.search-info {
  color: #ce9178;
  font-size: 11px;
  white-space: nowrap;
  margin-left: 4px;
}

.ascii-col {
  color: #ce9178;
  width: 130px;
  flex-shrink: 0;
  font-family: var(--vscode-editor-font-family);
  white-space: pre;
  font-size: 12px;
}

.hex-header-byte {
  display: inline-block;
  width: 22px;
  flex-shrink: 0;
  box-sizing: border-box;
  border: 1px solid transparent;
  text-align: center;
  color: #569cd6;
  font-size: 12px;
}

.sprite-header-controls {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  margin-bottom: 4px;
}

.sprite-scale-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
}

.sprite-scale-controls label {
  color: #569cd6;
  font-weight: bold;
}

.sprite-scale-controls button {
  background: #2d2d30;
  border: 1px solid #3e3e42;
  color: #d4d4d4;
  width: 20px;
  height: 20px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.sprite-scale-controls button:hover {
  background: #37373d;
  border-color: #4ec9b0;
}

.sprite-scale-controls button:active {
  background: #1e1e1e;
}

.scale-value {
  color: #b5cea8;
  min-width: 24px;
  text-align: center;
  font-family: var(--vscode-editor-font-family);
}

.sprite-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  background: #1e1e1e;
  padding: 4px;
  border-radius: 3px;
  border: 1px solid #3e3e42;
}

.sprite-container {
  display: flex;
  flex-direction: column;
  background: #252526;
  padding: 4px;
  border-radius: 3px;
  border: 1px solid #3e3e42;
  flex: 1 1 auto;
  min-width: 150px;
}

.sprite-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2px;
  padding: 0 2px;
  min-width: 150px;
}

.sprite-label {
  color: #569cd6;
  font-weight: bold;
  font-size: 12px;
}

.sprite-info {
  color: #ce9178;
  font-size: 10px;
  text-align: right;
}

.sprite-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
}

.sprite-canvas {
  image-rendering: pixelated;
  image-rendering: crisp-edges;
  border: 1px solid #3e3e42;
  flex-shrink: 0;
}

.sprite-regs {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 4px;
  font-size: 10px;
  font-family: var(--vscode-editor-font-family);
  justify-content: center;
  width: 100%;
}

.reg-row {
  display: flex;
  gap: 1px;
  align-items: center;
}

.reg-label {
  color: #569cd6;
  font-weight: bold;
  width: 10px;
}

.reg-value {
  color: #b5cea8;
  font-size: 10px;
}

.screen-controls {
  margin-bottom: 4px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.control-row {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.control-row label {
  color: #569cd6;
  font-weight: bold;
  font-size: 13px;
}

.control-row select,
.control-row input {
  background: #2d2d30;
  border: 1px solid #3e3e42;
  color: #d4d4d4;
  padding: 1px 4px;
  border-radius: 3px;
  font-family: var(--vscode-editor-font-family);
  font-size: 12px;
}

.control-row input {
  width: 60px;
}

.control-row select {
  min-width: 120px;
}

.control-row select:focus,
.control-row input:focus {
  outline: none;
  border-color: #4ec9b0;
}

.control-row button {
  background: #2d2d30;
  border: 1px solid #3e3e42;
  color: #d4d4d4;
  padding: 1px 8px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s ease;
}

.control-row button:hover {
  background: #37373d;
  border-color: #4ec9b0;
}

.control-row button:active {
  background: #1e1e1e;
}

.screen-canvas {
  width: 100%;
  max-width: 640px;
  height: auto;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
  border: 2px solid #3e3e42;
  background: #000;
  border-radius: 3px;
}
</style>
