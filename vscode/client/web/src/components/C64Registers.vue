<template>
  <div class="registers">
    <CollapsibleTile title="Registers & Flags" storageKey="registers">
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

    <CollapsibleTile title="Memory Viewer" storageKey="memory">
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
              @click="navigateMemory(-1000)"
              title="Previous screen (-$3E8, 25 rows)"
              class="nav-btn"
            >
              ◀◀
            </button>
            <button
              @click="navigateMemory(-40)"
              title="Back one row (-$28, 40 bytes)"
              class="nav-btn"
            >
              ◀
            </button>
            <button
              @click="navigateMemory(-1)"
              title="Back one byte (-$01)"
              class="nav-btn"
            >
              ‹
            </button>
            <button
              @click="jumpToScreenMemory()"
              title="Go to Screen RAM"
              class="nav-btn screen-link-btn"
            >
              SCR
            </button>
            <button
              @click="navigateMemory(1)"
              title="Forward one byte (+$01)"
              class="nav-btn"
            >
              ›
            </button>
            <button
              @click="navigateMemory(40)"
              title="Forward one row (+$28, 40 bytes)"
              class="nav-btn"
            >
              ▶
            </button>
            <button
              @click="navigateMemory(1000)"
              title="Next screen (+$3E8, 25 rows)"
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
              <span class="ascii-col">PETSCII</span>
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
                    @blur="
                      focusedAddress = null;
                      updateMemoryByte(row.address + idx, $event);
                    "
                    @focus="focusedAddress = row.address + idx"
                    @mouseover="hoveredAddress = row.address + idx"
                    @mouseleave="hoveredAddress = null"
                    @keyup.enter="($event.target as HTMLInputElement).blur()"
                    maxlength="2"
                  />
                </span>
                <span class="ascii-col">
                  <span
                    v-for="(char, idx) in row.asciiChars"
                    :key="idx"
                    :class="{
                      highlight:
                        hoveredAddress === row.address + idx ||
                        focusedAddress === row.address + idx,
                    }"
                    >{{ char }}</span
                  >
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </CollapsibleTile>

    <CollapsibleTile title="Sprite Viewer" storageKey="sprites">
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
                :ref="(el) => (spriteCanvasRefs[idx] = el as HTMLCanvasElement)"
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

    <CollapsibleTile title="Screen Viewer" storageKey="screen">
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
              <option value="auto">Auto (from VIC-II)</option>
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
              effectiveScreenMode.startsWith("bitmap") ? "Bitmap:" : "Charset:"
            }}</label>
            <input
              id="charsetAddr"
              v-model="manualCharsetAddr"
              :placeholder="
                effectiveScreenMode.startsWith('bitmap') ? '2000' : '1000'
              "
            />

            <button @click="refreshScreenData">Refresh</button>
          </div>
        </div>
        <div
          class="screen-canvas-container"
          @mousemove="onScreenMouseMove"
          @mouseleave="onScreenMouseLeave"
        >
          <canvas
            ref="screenCanvas"
            class="screen-canvas"
            width="320"
            height="200"
          ></canvas>
          <div
            v-if="hoveredScreenCell"
            class="screen-hover-overlay"
            :style="{
              top: (hoveredScreenCell.row / 25) * 100 + '%',
              left: (hoveredScreenCell.col / 40) * 100 + '%',
              width: 100 / 40 + '%',
              height: 100 / 25 + '%',
            }"
            :title="`Char $${formatHex(hoveredScreenCell.charCode, 2)} (${
              hoveredScreenCell.charCode
            }) at col ${hoveredScreenCell.col}, row ${hoveredScreenCell.row}`"
          >
            <span class="screen-hover-label">
              ${{ formatHex(hoveredScreenCell.charCode, 2) }}
            </span>
          </div>
          <div
            v-else
            v-for="(cell, idx) in instancesOfHoveredCharset"
            :key="'instances-' + idx"
            class="screen-hover-overlay"
            :style="{
              top: (cell.row / 25) * 100 + '%',
              left: (cell.col / 40) * 100 + '%',
              width: 100 / 40 + '%',
              height: 100 / 25 + '%',
            }"
            :title="`Col ${cell.col}, Row ${cell.row}`"
          ></div>
        </div>
      </div>
    </CollapsibleTile>
  </div>

  <div class="charset-viewer">
    <CollapsibleTile title="Charset Viewer" storageKey="charset">
      <div class="charset-controls">
        <div class="memory-controls">
          <label for="charsetSource">Source:</label>
          <select
            id="charsetSource"
            v-model="charsetSource"
            class="control-select"
          >
            <option value="vic">VIC-II Auto</option>
            <option value="manual">Manual Address</option>
          </select>

          <label for="charsetMode">Mode:</label>
          <select id="charsetMode" v-model="charsetMode" class="control-select">
            <option value="auto">Auto (from VIC-II)</option>
            <option value="single">Single Color</option>
            <option value="multi">Multicolor</option>
          </select>

          <label
            for="charsetBg"
            title="Background Color (Bits 00). Mapped to VIC-II $D021 in Auto mode."
            >BG:</label
          >
          <select
            id="charsetBg"
            v-model="charsetManualBgColor"
            class="color-select"
            title="Background Color (Bits 00). Mapped to VIC-II $D021 in Auto mode."
          >
            <option
              v-for="c in c64ColorOptions"
              :key="c.value"
              :value="c.value"
              :style="{
                backgroundColor: c.color,
                color: c.value === 1 || c.value >= 7 ? '#000' : '#fff',
              }"
            >
              {{ c.label }}
            </option>
          </select>

          <label
            for="charsetFg"
            title="Foreground Color in Single Color (Bit 1) or Multicolor 3 (Bits 11)."
            >FG (SC/MC3):</label
          >
          <select
            id="charsetFg"
            v-model="charsetManualFgColor"
            class="color-select"
            title="Foreground Color in Single Color (Bit 1) or Multicolor 3 (Bits 11)."
          >
            <option
              v-for="c in c64ColorOptions"
              :key="c.value"
              :value="c.value"
              :style="{
                backgroundColor: c.color,
                color: c.value === 1 || c.value >= 7 ? '#000' : '#fff',
              }"
            >
              {{ c.label }}
            </option>
          </select>

          <template v-if="charsetEffectiveMode === 'multi'">
            <label
              for="charsetMc1"
              title="Multicolor 1 (Bits 01). Mapped to VIC-II $D022 in Auto mode."
              >MC1:</label
            >
            <select
              id="charsetMc1"
              v-model="charsetManualMc1Color"
              class="color-select"
              title="Multicolor 1 (Bits 01). Mapped to VIC-II $D022 in Auto mode."
            >
              <option
                v-for="c in c64ColorOptions"
                :key="c.value"
                :value="c.value"
                :style="{
                  backgroundColor: c.color,
                  color: c.value === 1 || c.value >= 7 ? '#000' : '#fff',
                }"
              >
                {{ c.label }}
              </option>
            </select>

            <label
              for="charsetMc2"
              title="Multicolor 2 (Bits 10). Mapped to VIC-II $D023 in Auto mode."
              >MC2:</label
            >
            <select
              id="charsetMc2"
              v-model="charsetManualMc2Color"
              class="color-select"
              title="Multicolor 2 (Bits 10). Mapped to VIC-II $D023 in Auto mode."
            >
              <option
                v-for="c in c64ColorOptions"
                :key="c.value"
                :value="c.value"
                :style="{
                  backgroundColor: c.color,
                  color: c.value === 1 || c.value >= 7 ? '#000' : '#fff',
                }"
              >
                {{ c.label }}
              </option>
            </select>
          </template>
        </div>

        <div v-if="charsetSource === 'manual'" class="memory-controls">
          <label for="charsetAddrManual">Charset Addr (hex):</label>
          <input
            id="charsetAddrManual"
            v-model="charsetManualAddr"
            placeholder="1000"
            class="hex-input"
          />

          <button class="nav-btn" @click="refreshCharsetData">Refresh</button>
        </div>
      </div>
      <div class="charset-grid-container">
        <div class="charset-grid">
          <div
            v-for="i in 256"
            :key="i - 1"
            class="char-cell"
            :class="{
              'highlight-from-screen': hoveredScreenCell?.charCode === i - 1,
            }"
            :title="'Char $' + formatHex(i - 1, 2) + ' (' + (i - 1) + ')'"
            @mouseenter="hoveredCharsetChar = i - 1"
            @mouseleave="hoveredCharsetChar = null"
          >
            <div class="char-label">{{ formatHex(i - 1, 2) }}</div>
            <canvas
              :ref="(el) => setCharsetCanvasRef(el as HTMLCanvasElement | null, i - 1)"
              width="16"
              height="16"
              class="char-canvas"
            ></canvas>
          </div>
        </div>
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
  interface VsCodeApi {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
  }
  // eslint-disable-next-line no-var
  var acquireVsCodeApi: () => VsCodeApi;
  interface Window {
    vscodeApi?: VsCodeApi;
  }
}

export default defineComponent({
  name: "C64Registers",
  components: {
    CollapsibleTile,
  },
  setup() {
    let memoryBatchQueue: Array<{
      start: number;
      end: number;
      bankId: number;
      tag: string;
    }> = [];
    let memoryBatchTimer: number | null = null;

    const queueGetMemory = (
      start: number,
      end: number,
      bankId: number,
      tag: string
    ) => {
      memoryBatchQueue.push({ start, end, bankId, tag });
      if (!memoryBatchTimer) {
        memoryBatchTimer = window.setTimeout(() => {
          if (vscode && memoryBatchQueue.length > 0) {
            vscode.postMessage({
              command: "getMemoryBatch",
              requests: [...memoryBatchQueue],
            });
            memoryBatchQueue = [];
          }
          memoryBatchTimer = null;
        }, 15);
      }
    };

    const store = useStore();

    if (!window.vscodeApi && typeof acquireVsCodeApi !== "undefined") {
      window.vscodeApi = acquireVsCodeApi();
    }
    const vscode = window.vscodeApi;

    const availableBanks = computed(() => store.state.AvailableBanks);
    const getBankId = (name: string): number => {
      const bank = availableBanks.value.find(
        (b: { id: number; name: string }) => b.name === name
      );
      return bank ? bank.id : 0;
    };

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
    const bytesPerRow = 40; // C64 screen columns
    const numRows = 25; // C64 screen rows (40×25 = 1000 bytes = one screen)

    const memory = computed(() => store.state.MemoryViewer);
    const cia2Base = computed(() => store.state.Cia2Base ?? 3);
    const vicBankBaseAddress = computed(() => {
      // Bits 0-1 of $DD00 select the 16KB bank (inverted)
      // 3 -> $0000, 2 -> $4000, 1 -> $8000, 0 -> $C000
      const bank = 3 - (cia2Base.value & 3);
      return bank * 0x4000;
    });

    const previousMemory = ref<number[]>([]);
    const previousBaseOffset = ref(0);
    const isFirstLoad = ref(true);
    const searchQuery = ref("");
    const searchResults = ref<{ address: number; length: number }[]>([]);

    const hoveredAddress = ref<number | null>(null);
    const focusedAddress = ref<number | null>(null);

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
        queueGetMemory(start, end, 0, "memoryViewer");
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

    // Jump memory viewer to the current screen RAM address.
    // Reads $D018 bits 7-4 to find the screen offset within the VIC bank.
    const jumpToScreenMemory = () => {
      let addr: number;
      if (screenSource.value === "manual") {
        addr =
          parseInt(manualScreenAddr.value.replace(/[$]/g, ""), 16) || 0x0400;
      } else {
        // VIC-II $D018 bits 7-4 × 1024 = screen base within VIC bank
        const d018 = vicRegs.value[0x18] || 0x14;
        addr = ((d018 >> 4) & 0xf) * 1024;
      }
      if (addr >= 0 && addr <= 0xffff) {
        baseOffset.value = addr;
        memoryOffset.value = addr.toString(16).toUpperCase().padStart(4, "0");
        previousMemory.value = [];
        previousBaseOffset.value = addr;
        requestMemory();
      }
    };

    // Full PETSCII uppercase/graphics → Unicode lookup table (256 entries).
    // Screen-code ranges $40-$5F (PETSCII $60-$7F) and $60-$7F (PETSCII $A0-$BF)
    // are taken from the authoritative screen-mappings reference.
    const PETSCII_TABLE: string[] = (() => {
      const t = new Array<string>(256).fill(".");

      // Hybrid mapping: map $00-$1F (Screen Codes) to their visual text equivalents
      // so screen memory ($0400+) is readable in the memory viewer.
      t[0x00] = "@";
      for (let i = 0x01; i <= 0x1a; i++) t[i] = String.fromCharCode(0x40 + i);
      t[0x1b] = "[";
      t[0x1c] = "\u00A3";
      t[0x1d] = "]";
      t[0x1e] = "\u2191";
      t[0x1f] = "\u2190";

      // $20-$3F: identical to ASCII
      for (let i = 0x20; i <= 0x3f; i++) t[i] = String.fromCharCode(i);
      // $40: @, $41-$5A: A-Z, $5B-$5F: special
      t[0x40] = "@";
      for (let i = 0x41; i <= 0x5a; i++) t[i] = String.fromCharCode(i);
      t[0x5b] = "[";
      t[0x5c] = "\u00A3";
      t[0x5d] = "]";
      t[0x5e] = "\u2191";
      t[0x5f] = "\u2190";
      // $60-$7F: graphics (screen codes $40-$5F)
      const sc40 = [
        "\u2501",
        "\u2660",
        "\u2503",
        "\u2501",
        "\u23BB",
        "\u23BA",
        "\u2501",
        "\u2503",
        "\u2503",
        "\u256E",
        "\u2570",
        "\u256F",
        "\u231E",
        "\u2572",
        "\u2571",
        "\u231C",
        "\u231D",
        "\u2B24",
        "\u23BD",
        "\u2665",
        "\u2758",
        "\u256D",
        "\u2573",
        "\u25CB",
        "\u2663",
        "\u2759",
        "\u25C6",
        "\u254B",
        "\u258C",
        "\u2503",
        "\u03C0",
        "\u25E5",
      ];
      for (let i = 0; i < 32; i++) t[0x60 + i] = sc40[i];
      // $A0-$BF: graphics (screen codes $60-$7F)
      const sc60 = [
        "\u00A0",
        "\u258C",
        "\u2584",
        "\u2594",
        "\u2581",
        "\u258E",
        "\u259A",
        "\u2588",
        "\u2584",
        "\u25E4",
        "\u2588",
        "\u2523",
        "\u2597",
        "\u2517",
        "\u2513",
        "\u2582",
        "\u250F",
        "\u253B",
        "\u2533",
        "\u252B",
        ".",
        "\u258E",
        "\u258D",
        "\u258B",
        "\u2586",
        "\u2583",
        "\u231F",
        "\u2596",
        "\u259D",
        "\u251B",
        "\u2598",
        "\u259A",
      ];
      for (let i = 0; i < 32; i++) t[0xa0 + i] = sc60[i];
      // $C0-$DF: same characters as $60-$7F
      for (let i = 0; i < 32; i++) t[0xc0 + i] = t[0x60 + i];
      // $E0-$FE: same characters as $A0-$BE
      for (let i = 0; i < 31; i++) t[0xe0 + i] = t[0xa0 + i];
      t[0xff] = "\u03C0"; // π
      return t;
    })();

    const petsciiToChar = (byte: number): string => PETSCII_TABLE[byte];

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

        let asciiChars: string[] = [];

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
            ascii += petsciiToChar(byte);
            asciiChars.push(petsciiToChar(byte));
          } else {
            ascii += ".";
            asciiChars.push(".");
          }
        }

        rows.push({
          address,
          bytes,
          ascii,
          asciiChars,
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
    const spriteCanvasRefs = ref<HTMLCanvasElement[]>([]);
    const spriteScale = ref(3); // Default 3x scale
    const screenCanvas = ref<HTMLCanvasElement | null>(null);

    const hoveredScreenCell = ref<{
      col: number;
      row: number;
      charCode: number;
    } | null>(null);

    const hoveredCharsetChar = ref<number | null>(null);

    const instancesOfHoveredCharset = computed(() => {
      if (hoveredCharsetChar.value === null) return [];
      const screenMem = screenMemoryFromStore.value;
      const chars = [];
      for (let i = 0; i < screenMem.length; i++) {
        if (screenMem[i] === hoveredCharsetChar.value) {
          chars.push({ col: i % 40, row: Math.floor(i / 40) });
        }
      }
      return chars;
    });

    // Screen viewer controls
    const screenSource = ref<"vic" | "manual">("vic");
    const screenMode = ref<
      "auto" | "text-sc" | "text-mc" | "bitmap-sc" | "bitmap-mc"
    >("auto");
    const manualScreenAddr = ref("0400");
    const manualColorAddr = ref("D800");
    const manualCharsetAddr = ref("1000");

    // VIC-II registers and sprite memory from store
    const vicRegs = computed(() => store.state.VicRegs || Array(47).fill(0)); // $D000-$D02E

    // When mode is "auto", derive the rendering mode from the actual VIC registers.
    // $D011 bit 5 = BMM (bitmap mode), $D016 bit 4 = MCM (multicolor mode).
    // In text-mc mode, color RAM bit 3 is then checked per-character to decide
    // whether a given character uses multicolor or single-color rendering.
    const effectiveScreenMode = computed(() => {
      if (screenMode.value === "auto") {
        const d011 = vicRegs.value[0x11] || 0; // $D011
        const d016 = vicRegs.value[0x16] || 0; // $D016
        const bmm = (d011 >> 5) & 1; // Bit 5 = Bitmap mode
        const mcm = (d016 >> 4) & 1; // Bit 4 = Multicolor mode
        if (bmm) return mcm ? "bitmap-mc" : "bitmap-sc";
        return mcm ? "text-mc" : "text-sc";
      }
      return screenMode.value;
    });
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
        .map((_, i) => vicRegs.value[0x27 + i] ?? 1);
    });

    const backgroundColor = computed(() => vicRegs.value[0x21] ?? 0); // $D021
    const spriteMulticolor1 = computed(() => vicRegs.value[0x25] ?? 0); // $D025
    const spriteMulticolor2 = computed(() => vicRegs.value[0x26] ?? 0); // $D026

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

    const c64ColorNames = [
      "Black",
      "White",
      "Red",
      "Cyan",
      "Purple",
      "Green",
      "Blue",
      "Yellow",
      "Orange",
      "Brown",
      "Light Red",
      "Dark Grey",
      "Grey",
      "Light Green",
      "Light Blue",
      "Light Grey",
    ];

    const c64ColorOptions = c64Colors.map((color, index) => ({
      value: index,
      label: `${index} - ${c64ColorNames[index]}`,
      color,
    }));

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

    const onScreenMouseMove = (event: MouseEvent) => {
      if (!screenCanvas.value) return;
      const rect = screenCanvas.value.getBoundingClientRect();
      const scaleX = screenCanvas.value.width / rect.width;
      const scaleY = screenCanvas.value.height / rect.height;

      const x = (event.clientX - rect.left) * scaleX;
      const y = (event.clientY - rect.top) * scaleY;

      const col = Math.floor(x / 8);
      const row = Math.floor(y / 8);

      if (col >= 0 && col < 40 && row >= 0 && row < 25) {
        const screenOffset = row * 40 + col;
        const charCode = screenMemoryFromStore.value[screenOffset] ?? null;
        if (charCode !== null) {
          hoveredScreenCell.value = { col, row, charCode };
          return;
        }
      }
      hoveredScreenCell.value = null;
    };

    const onScreenMouseLeave = () => {
      hoveredScreenCell.value = null;
    };

    // C64 screen viewer - renders 40x25 character screen
    const renderScreen = () => {
      if (!screenCanvas.value) return;

      const ctx = screenCanvas.value.getContext("2d");
      if (!ctx) return;

      const screenMem = screenMemoryFromStore.value;
      const colorMem = colorMemoryFromStore.value;
      const charMem = charsetMemoryFromStore.value;
      const bgColor = backgroundColor.value;
      const mode = effectiveScreenMode.value;

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
            const charCode = screenMem[screenOffset] ?? 0;
            const color = colorMem[screenOffset] ?? 1;
            const charOffset = charCode * 8;

            for (let charRow = 0; charRow < 8; charRow++) {
              const charByte = charMem[charOffset + charRow] ?? 0;
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
        const mc1 = vicRegs.value[0x22] ?? 0; // $D022
        const mc2 = vicRegs.value[0x23] ?? 0; // $D023

        for (let row = 0; row < 25; row++) {
          for (let col = 0; col < 40; col++) {
            const screenOffset = row * 40 + col;
            const charCode = screenMem[screenOffset] ?? 0;
            const colorCode = colorMem[screenOffset] ?? 1;
            const charOffset = charCode * 8;
            const isMulticolor = colorCode >= 8; // Bit 3 set = multicolor

            for (let charRow = 0; charRow < 8; charRow++) {
              const charByte = charMem[charOffset + charRow] ?? 0;

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
            const colorByte = screenMem[screenOffset] ?? 0;
            const fgColor = (colorByte >> 4) & 0x0f;
            const bgColorLocal = colorByte & 0x0f;

            const bitmapOffset = charRow * 320 + x * 8 + pixelRow;
            const bitmapByte = charMem[bitmapOffset] ?? 0;

            for (let bit = 0; bit < 8; bit++) {
              const pixel = (bitmapByte >> (7 - bit)) & 1;
              ctx.fillStyle = c64Colors[pixel ? fgColor : bgColorLocal];
              ctx.fillRect(x * 8 + bit, y, 1, 1);
            }
          }
        }
      } else if (mode === "bitmap-mc") {
        // Bitmap mode, multicolor
        const mc2 = vicRegs.value[0x23] || 0; // $D023 (background 2)

        for (let y = 0; y < 200; y++) {
          const charRow = Math.floor(y / 8);
          const pixelRow = y % 8;

          for (let x = 0; x < 40; x++) {
            const screenOffset = charRow * 40 + x;
            const colorByte = screenMem[screenOffset] ?? 0;
            const colorNibbleHigh = (colorByte >> 4) & 0x0f;

            const colorOffset = charRow * 40 + x;
            const colorNibbleLow = colorMem[colorOffset] ?? 0; // also ensuring we fallback gracefully if out of bounds

            const bitmapOffset = charRow * 320 + x * 8 + pixelRow;
            const bitmapByte = charMem[bitmapOffset] ?? 0;

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

    watch(
      [vicRegs, screenSource, cia2Base],
      () => {
        // Re-fetch memory when VIC registers (like D018) or VIC bank block changes
        refreshScreenData();
        renderScreen();
      },
      { deep: true }
    );

    // Refresh screen data
    const refreshScreenData = () => {
      if (!vscode) return;

      try {
        let screenAddr = 0x0400;
        let colorAddr = 0xd800;
        let charsetAddr = 0xd000;
        let screenBankId = 0;
        let colorBankId = 0;
        let charsetBankId = 0;

        if (screenSource.value === "manual") {
          screenAddr = parseInt(manualScreenAddr.value.replace(/[$]/g, ""), 16);
          colorAddr = parseInt(manualColorAddr.value.replace(/[$]/g, ""), 16);
          charsetAddr = parseInt(
            manualCharsetAddr.value.replace(/[$]/g, ""),
            16
          );

          // For manual, we usually want CPU bank, except if they explicitly ask for D000 we might want ROM
          screenBankId = getBankId("cpu");
          colorBankId = getBankId("io");
          // If accessing character ROM area natively, fetch from "rom" bank to get characters, not IO
          charsetBankId =
            charsetAddr >= 0xd000 && charsetAddr <= 0xdfff
              ? getBankId("rom")
              : getBankId("cpu");
        } else {
          // Auto mode: calculate from VIC-II registers
          const d018 = vicRegs.value[0x18] || 0x14;
          const baseAddress = vicBankBaseAddress.value;

          // Inside the VIC-II's 16KB window:
          // Screen memory is at offset ((D018 >> 4) & 0x0F) * 1024
          screenAddr = baseAddress + ((d018 >> 4) & 0x0f) * 1024;
          // Charset memory is at offset ((D018 >> 1) & 0x07) * 2048
          charsetAddr = baseAddress + ((d018 >> 1) & 0x07) * 2048;

          // Color RAM is always at D800 in CPU space
          colorAddr = 0xd800;

          // Standard VICE monitor has no "vicii" bank, we access it from "ram"
          // or fallback to "cpu" which is essentially Bank 0 in the debug protocol
          screenBankId = getBankId("ram") || getBankId("cpu");
          colorBankId = getBankId("io");

          // If charset points to the Character ROM area (0x1000-0x1FFF or 0x9000-0x9FFF in VIC-II space),
          // map these explicitly to the "rom" bank at 0xD000.
          if (
            (charsetAddr >= 0x1000 && charsetAddr <= 0x1fff) ||
            (charsetAddr >= 0x9000 && charsetAddr <= 0x9fff)
          ) {
            charsetAddr = 0xd000 + (charsetAddr & 0x0fff);
            charsetBankId = getBankId("rom");
          } else {
            charsetBankId = screenBankId;
          }
        }

        if (effectiveScreenMode.value.startsWith("text")) {
          // Text mode: screen = 1000 bytes, charset = 2048 bytes
          queueGetMemory(
            screenAddr,
            screenAddr + 999,
            screenBankId,
            "screenMemory"
          );
          queueGetMemory(
            colorAddr,
            colorAddr + 999,
            colorBankId,
            "colorMemory"
          );
          queueGetMemory(
            charsetAddr,
            charsetAddr + 2047,
            charsetBankId,
            "charsetMemory"
          );
        } else {
          // Bitmap mode: screen = 1000 bytes (color info), bitmap = 8000 bytes
          queueGetMemory(
            screenAddr,
            screenAddr + 999,
            screenBankId,
            "screenMemory"
          );
          queueGetMemory(
            colorAddr,
            colorAddr + 999,
            colorBankId,
            "colorMemory"
          );
          queueGetMemory(
            charsetAddr,
            charsetAddr + 7999,
            charsetBankId,
            "charsetMemory"
          );
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
          const bankId = getBankId("ram") || getBankId("cpu");
          const baseAddress =
            screenSource.value === "vic" ? vicBankBaseAddress.value : 0;
          newPointers.forEach((ptr: number, idx: number) => {
            const addr = baseAddress + ptr * 64;
            queueGetMemory(addr, addr + 63, bankId, `spriteData:${idx}`);
          });
        }
      },
      { deep: true, immediate: true }
    );

    // Request VIC-II registers and sprite data from debugger
    const requestSpriteData = () => {
      if (vscode) {
        // Request CIA2 base to know VIC bank ($DD00)
        queueGetMemory(0xdd00, 0xdd00, getBankId("io"), "cia2Base");

        // Request VIC-II registers ($D000-$D02E) from CPU space (IO)
        queueGetMemory(0xd000, 0xd02e, getBankId("io"), "vicRegs");

        // Request sprite pointers
        // In "vic" mode they are at screenBase + $03F8 in the VICII bank
        let ptrAddr = 0x07f8;
        let ptrBankId = getBankId("cpu");

        if (screenSource.value === "vic") {
          const d018 = vicRegs.value[0x18] || 0x14;
          const screenBase =
            vicBankBaseAddress.value + ((d018 >> 4) & 0x0f) * 1024;
          ptrAddr = screenBase + 0x03f8;
          ptrBankId = getBankId("ram") || getBankId("cpu");
        }

        queueGetMemory(ptrAddr, ptrAddr + 7, ptrBankId, "spritePointers");
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

    const charsetSource = ref<"vic" | "manual">("vic");
    const charsetMode = ref<"auto" | "single" | "multi">("auto");
    const charsetManualAddr = ref("1000");
    const charsetManualBgColor = ref(0);
    const charsetManualFgColor = ref(1);
    const charsetManualMc1Color = ref(11);
    const charsetManualMc2Color = ref(12);

    const charsetCanvasRefs = ref<(HTMLCanvasElement | null)[]>(
      new Array(256).fill(null)
    );

    const setCharsetCanvasRef = (
      el: HTMLCanvasElement | null,
      index: number
    ) => {
      charsetCanvasRefs.value[index] = el;
    };

    const charsetTileMemoryFromStore = computed(
      () => store.state.CharsetTileMemory || new Uint8Array(2048)
    );

    const charsetEffectiveMode = computed(() => {
      if (charsetMode.value === "auto") {
        const d016 = vicRegs.value[0x16] || 0;
        return (d016 >> 4) & 1 ? "multi" : "single";
      }
      return charsetMode.value;
    });

    const renderCharsetGrid = () => {
      const charMem = charsetTileMemoryFromStore.value;
      const isMulti = charsetEffectiveMode.value === "multi";

      const bgColorVal =
        charsetSource.value === "vic" || charsetMode.value === "auto"
          ? vicRegs.value[0x21] || 0
          : charsetManualBgColor.value;
      const fgColorVal = charsetManualFgColor.value;
      const mc1 =
        charsetSource.value === "vic" || charsetMode.value === "auto"
          ? vicRegs.value[0x22] || 0
          : charsetManualMc1Color.value;
      const mc2 =
        charsetSource.value === "vic" || charsetMode.value === "auto"
          ? vicRegs.value[0x23] || 0
          : charsetManualMc2Color.value;

      const bgColor = c64Colors[bgColorVal & 0x0f];
      const fgColor = c64Colors[fgColorVal & 0x0f];
      const mc1Color = c64Colors[mc1 & 0x0f];
      const mc2Color = c64Colors[mc2 & 0x0f];

      for (let i = 0; i < 256; i++) {
        const canvas = charsetCanvasRefs.value[i];
        if (!canvas) continue;
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;

        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, 16, 16);

        const charOffset = i * 8;
        for (let row = 0; row < 8; row++) {
          const byte = charMem[charOffset + row] || 0;
          if (isMulti) {
            for (let pair = 0; pair < 4; pair++) {
              const bitPair = (byte >> (6 - pair * 2)) & 0x03;
              let color = "";
              switch (bitPair) {
                case 0:
                  break;
                case 1:
                  color = mc1Color;
                  break;
                case 2:
                  color = mc2Color;
                  break;
                case 3:
                  color = fgColor;
                  break;
              }
              if (color) {
                ctx.fillStyle = color;
                ctx.fillRect(pair * 4, row * 2, 4, 2);
              }
            }
          } else {
            for (let col = 0; col < 8; col++) {
              const bit = (byte >> (7 - col)) & 1;
              if (bit) {
                ctx.fillStyle = fgColor;
                ctx.fillRect(col * 2, row * 2, 2, 2);
              }
            }
          }
        }
      }
    };

    const refreshCharsetData = () => {
      if (!vscode) return;

      let addr = 0x1000;
      let bankId = 0;

      if (charsetSource.value === "manual") {
        addr = parseInt(charsetManualAddr.value.replace(/[$]/g, ""), 16);
        if (isNaN(addr)) addr = 0x1000;

        bankId =
          addr >= 0xd000 && addr <= 0xdfff
            ? getBankId("rom")
            : getBankId("cpu");
      } else {
        const d018 = vicRegs.value[0x18] || 0x14;
        addr = vicBankBaseAddress.value + ((d018 >> 1) & 0x07) * 2048;

        bankId = getBankId("ram") || getBankId("cpu");

        if (
          (addr >= 0x1000 && addr <= 0x1fff) ||
          (addr >= 0x9000 && addr <= 0x9fff)
        ) {
          addr = 0xd000 + (addr & 0x0fff);
          bankId = getBankId("rom");
        }
      }

      queueGetMemory(addr, addr + 2047, bankId, "charsetTileMemory");
    };

    watch(
      [
        charsetSource,
        charsetMode,
        charsetManualAddr,
        charsetManualBgColor,
        charsetManualFgColor,
        charsetManualMc1Color,
        charsetManualMc2Color,
        vicRegs,
        cia2Base,
      ],
      () => {
        refreshCharsetData();
        renderCharsetGrid();
      },
      { deep: true }
    );

    watch(charsetTileMemoryFromStore, () => {
      renderCharsetGrid();
    });

    if (vscode) {
      const savedState = (vscode.getState() || {}) as {
        memoryOffset?: string;
        baseOffset?: number;
        searchQuery?: string;
        spriteScale?: number;
        screenSource?: "vic" | "manual";
        screenMode?: "auto" | "text-sc" | "text-mc" | "bitmap-sc" | "bitmap-mc";
        manualScreenAddr?: string;
        manualColorAddr?: string;
        manualCharsetAddr?: string;
        charsetSource?: "vic" | "manual";
        charsetMode?: "auto" | "single" | "multi";
        charsetManualAddr?: string;
        charsetManualBgColor?: number;
        charsetManualFgColor?: number;
        charsetManualMc1Color?: number;
        charsetManualMc2Color?: number;
      };
      if (savedState.memoryOffset !== undefined)
        memoryOffset.value = savedState.memoryOffset;
      if (savedState.baseOffset !== undefined)
        baseOffset.value = savedState.baseOffset;
      if (savedState.searchQuery !== undefined)
        searchQuery.value = savedState.searchQuery;
      if (savedState.spriteScale !== undefined)
        spriteScale.value = savedState.spriteScale;
      if (savedState.screenSource !== undefined)
        screenSource.value = savedState.screenSource;
      if (savedState.screenMode !== undefined)
        screenMode.value = savedState.screenMode;
      if (savedState.manualScreenAddr !== undefined)
        manualScreenAddr.value = savedState.manualScreenAddr;
      if (savedState.manualColorAddr !== undefined)
        manualColorAddr.value = savedState.manualColorAddr;
      if (savedState.manualCharsetAddr !== undefined)
        manualCharsetAddr.value = savedState.manualCharsetAddr;
      if (savedState.charsetSource !== undefined)
        charsetSource.value = savedState.charsetSource;
      if (savedState.charsetMode !== undefined)
        charsetMode.value = savedState.charsetMode;
      if (savedState.charsetManualAddr !== undefined)
        charsetManualAddr.value = savedState.charsetManualAddr;
      if (savedState.charsetManualBgColor !== undefined)
        charsetManualBgColor.value = savedState.charsetManualBgColor;
      if (savedState.charsetManualFgColor !== undefined)
        charsetManualFgColor.value = savedState.charsetManualFgColor;
      if (savedState.charsetManualMc1Color !== undefined)
        charsetManualMc1Color.value = savedState.charsetManualMc1Color;
      if (savedState.charsetManualMc2Color !== undefined)
        charsetManualMc2Color.value = savedState.charsetManualMc2Color;

      watch(
        [
          memoryOffset,
          baseOffset,
          searchQuery,
          spriteScale,
          screenSource,
          screenMode,
          manualScreenAddr,
          manualColorAddr,
          manualCharsetAddr,
          charsetSource,
          charsetMode,
          charsetManualAddr,
          charsetManualBgColor,
          charsetManualFgColor,
          charsetManualMc1Color,
          charsetManualMc2Color,
        ],
        () => {
          const currentState = (vscode.getState() || {}) as Record<
            string,
            unknown
          >;
          vscode.setState({
            ...currentState,
            memoryOffset: memoryOffset.value,
            baseOffset: baseOffset.value,
            searchQuery: searchQuery.value,
            spriteScale: spriteScale.value,
            screenSource: screenSource.value,
            screenMode: screenMode.value,
            manualScreenAddr: manualScreenAddr.value,
            manualColorAddr: manualColorAddr.value,
            manualCharsetAddr: manualCharsetAddr.value,
            charsetSource: charsetSource.value,
            charsetMode: charsetMode.value,
            charsetManualAddr: charsetManualAddr.value,
            charsetManualBgColor: charsetManualBgColor.value,
            charsetManualFgColor: charsetManualFgColor.value,
            charsetManualMc1Color: charsetManualMc1Color.value,
            charsetManualMc2Color: charsetManualMc2Color.value,
          });
        },
        { deep: true, immediate: true }
      );
    }

    onMounted(() => {
      if (vscode) {
        vscode.postMessage({ command: "getBanks" });
      }
      updateSpriteCanvases();
      renderScreen();
      refreshCharsetData();
      setTimeout(() => {
        renderCharsetGrid();
      }, 100);
    });

    return {
      hoveredScreenCell,
      hoveredCharsetChar,
      instancesOfHoveredCharset,
      onScreenMouseMove,
      onScreenMouseLeave,
      charsetSource,
      charsetMode,
      charsetEffectiveMode,
      charsetManualAddr,
      charsetManualBgColor,
      charsetManualFgColor,
      charsetManualMc1Color,
      charsetManualMc2Color,
      setCharsetCanvasRef,
      refreshCharsetData,
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
      jumpToScreenMemory,
      searchQuery,
      searchResults,
      hoveredAddress,
      focusedAddress,
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
      effectiveScreenMode,
      manualScreenAddr,
      manualColorAddr,
      manualCharsetAddr,
      c64ColorOptions,
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
  flex-wrap: wrap;
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

.screen-link-btn {
  background: #1e3a1e !important;
  border-color: #4ec9b0 !important;
  color: #4ec9b0 !important;
  font-weight: bold;
}

.screen-link-btn:hover {
  background: #2a4a2a !important;
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
  max-height: 500px;
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
  font-size: 11px;
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
  flex: 0 0 auto;
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
  font-size: 11px;
  padding: 0;
  width: 18px;
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
  border-left: 1px solid #3e3e42;
  padding-left: 8px;
  margin-left: 4px;
}

.ascii-col span.highlight {
  background-color: var(--vscode-editor-selectionBackground, #264f78);
  color: #fff;
}

.hex-header-byte {
  display: inline-block;
  width: 18px;
  flex-shrink: 0;
  box-sizing: border-box;
  border: 1px solid transparent;
  text-align: center;
  color: #569cd6;
  font-size: 11px;
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

.screen-canvas-container {
  position: relative;
  width: 100%;
  max-width: 640px;
  line-height: 0;
  border: 2px solid #3e3e42;
  border-radius: 3px;
  background: #000;
  box-sizing: content-box;
}

.screen-hover-overlay {
  position: absolute;
  border: 2px solid rgba(255, 0, 255, 0.8);
  pointer-events: none;
  box-sizing: border-box;
  background-color: rgba(255, 0, 255, 0.2);
  z-index: 10;
}

.screen-hover-label {
  position: absolute;
  background-color: rgba(255, 0, 255, 0.9);
  color: white;
  font-size: 10px;
  line-height: 10px;
  padding: 2px 4px;
  border-radius: 2px;
  top: -16px;
  left: 50%;
  transform: translateX(-50%);
  pointer-events: none;
  white-space: nowrap;
}

.screen-canvas {
  width: 100%;
  height: auto;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
  display: block;
}

.charset-viewer {
  font-family: var(--vscode-editor-font-family);
  font-size: 13px;
}

.charset-controls {
  padding: 4px;
  background: #1e1e1e;
}

.memory-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
  flex-wrap: wrap;
}

.memory-controls label {
  color: #569cd6;
  font-weight: bold;
  font-size: 13px;
}

.memory-controls input,
.memory-controls select,
.control-select {
  background: #2d2d30;
  border: 1px solid #3e3e42;
  color: #d4d4d4;
  padding: 1px 4px;
  border-radius: 3px;
  font-family: var(--vscode-editor-font-family);
  font-size: 13px;
}

.memory-controls input:focus,
.memory-controls select:focus {
  outline: none;
  border-color: #4ec9b0;
}

.color-input {
  width: 40px;
}

.hex-input {
  width: 60px;
}

.nav-btn {
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

.nav-btn:hover {
  background: #37373d;
  border-color: #4ec9b0;
}

.nav-btn:active {
  background: #1e1e1e;
}

.charset-grid-container {
  padding: 4px;
  background: #1e1e1e;
  border: 1px solid #3e3e42;
  border-radius: 3px;
  overflow-x: auto;
}

.charset-grid {
  display: grid;
  grid-template-columns: repeat(16, min-content);
  gap: 2px;
  background: #1e1e1e;
  justify-content: start; /* align to the left inside the scroll area */
}

.char-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 2px;
  border-radius: 3px;
  border: 1px solid transparent;
}

.char-cell:hover,
.char-cell.highlight-from-screen {
  background: #37373d;
  border-color: rgba(255, 255, 0, 0.8);
  box-shadow: 0 0 4px rgba(255, 255, 0, 0.5);
}

.char-label {
  font-size: 10px;
  color: #569cd6;
  margin-bottom: 2px;
  font-family: var(--vscode-editor-font-family);
}

.char-canvas {
  width: 24px;
  height: 24px;
  image-rendering: pixelated;
  border: 1px solid #3e3e42;
  background-color: #000;
}
</style>
