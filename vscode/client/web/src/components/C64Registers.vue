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
          <div class="memory-address-group">
            <div class="memory-address-row">
              <label for="memOffset">Base Address:</label>
              <input
                id="memOffset"
                v-model="memoryOffset"
                type="text"
                placeholder="0000"
                @input="updateMemoryOffset"
              />
            </div>
            <div class="memory-shortcuts">
              <button
                @click="jumpToMemoryRegion('screen')"
                title="Jump to current Screen RAM"
                class="nav-btn memory-shortcut-btn"
              >
                Screen RAM
              </button>
              <button
                @click="jumpToMemoryRegion('color')"
                title="Jump to Screen Color RAM"
                class="nav-btn memory-shortcut-btn"
              >
                Screen Color RAM
              </button>
              <button
                @click="jumpToMemoryRegion('charset')"
                :title="
                  effectiveScreenMode.startsWith('bitmap')
                    ? 'Jump to current bitmap memory'
                    : 'Jump to current character set memory'
                "
                class="nav-btn memory-shortcut-btn"
              >
                {{
                  effectiveScreenMode.startsWith("bitmap")
                    ? "Bitmap RAM"
                    : "CharSet RAM"
                }}
              </button>
              <button
                @click="jumpToMemoryRegion('sprites')"
                title="Jump to sprite pointer table"
                class="nav-btn memory-shortcut-btn"
              >
                Sprite Pointers
              </button>
              <button
                @click="jumpToMemoryRegion('vic')"
                title="Jump to VIC-II registers"
                class="nav-btn memory-shortcut-btn"
              >
                VIC-II Regs
              </button>
              <button
                @click="jumpToMemoryRegion('sid')"
                title="Jump to SID registers"
                class="nav-btn memory-shortcut-btn"
              >
                SID Regs
              </button>
            </div>
          </div>
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

    <CollapsibleTile title="Characters Screen Viewer" storageKey="screen">
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
              <option value="text-ecm">Text Extended BG (ECM)</option>
              <option value="bitmap-sc">Bitmap Single Color</option>
              <option value="bitmap-mc">Bitmap Multicolor</option>
            </select>

            <button
              v-if="screenSource === 'vic'"
              @click="refreshAllScreenData"
              title="Take a fresh snapshot of the VIC-II registers, screen, color RAM and charset (works while running too)"
            >
              Refresh
            </button>

            <template v-if="hasSelection">
              <span class="selection-badge">
                Selected: {{ selectedCharCodes.length }} char{{
                  selectedCharCodes.length === 1 ? "" : "s"
                }}
              </span>
              <button
                class="nav-btn clear-selection-btn"
                title="Clear selection (Esc)"
                @click="clearSelection"
              >
                Clear
              </button>
            </template>
          </div>

          <div
            v-if="screenSource === 'vic'"
            class="vic-status"
            title="VIC-II state used to render this view, sampled when the emulator was halted"
          >
            <span>
              Bank {{ vicStatus.bank }} ({{ formatHex(vicStatus.bankBase, 4) }})
            </span>
            <span>Screen {{ formatHex(vicStatus.screenAddr, 4) }}</span>
            <span>
              {{ vicStatus.isBitmap ? "Bitmap" : "Charset" }}
              {{ formatHex(vicStatus.charsetAddr, 4)
              }}{{ vicStatus.charsetInRom ? " (Char ROM)" : "" }}
            </span>
            <span>{{ effectiveScreenMode }}</span>
            <span>
              BG
              <span
                class="color-chip"
                :style="{ backgroundColor: colorCss(vicStatus.bg) }"
              ></span>
            </span>
            <span v-if="effectiveScreenMode === 'text-mc'">
              MC1
              <span
                class="color-chip"
                :style="{ backgroundColor: colorCss(vicStatus.mc1) }"
              ></span>
              MC2
              <span
                class="color-chip"
                :style="{ backgroundColor: colorCss(vicStatus.mc2) }"
              ></span>
            </span>
            <span
              :title="`$D011=${formatHex(vicStatus.d011, 2)} $D016=${formatHex(
                vicStatus.d016,
                2
              )} $D018=${formatHex(vicStatus.d018, 2)}`"
            >
              Raster {{ vicStatus.raster }}
            </span>
            <button
              class="nav-btn"
              title="Copy these addresses and colors into Manual Address mode, freezing them"
              @click="copyVicToManual"
            >
              → Manual
            </button>
          </div>
          <div v-if="screenWarning" class="vic-warning">
            {{ screenWarning }}
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

            <label for="manualCharsetMem">Mem:</label>
            <select
              id="manualCharsetMem"
              v-model="manualCharsetMem"
              class="compact-select"
              title="Auto: $1000-$1FFF, $9000-$9FFF and $D000-$DFFF read the Character ROM, everything else RAM. RAM/Char ROM force the memory read."
            >
              <option value="auto">Auto</option>
              <option value="ram">RAM</option>
              <option value="rom">Char ROM</option>
            </select>

            <button @click="refreshScreenData">Refresh</button>
          </div>

          <div v-if="screenSource === 'manual'" class="control-row">
            <label for="manualBg">BG:</label>
            <select
              id="manualBg"
              v-model.number="manualBgColor"
              class="compact-select"
            >
              <option :value="-1">Auto ($D021)</option>
              <option
                v-for="c in c64ColorOptions"
                :key="'bg' + c.value"
                :value="c.value"
              >
                {{ c.label }}
              </option>
            </select>
            <template v-if="effectiveScreenMode === 'text-mc'">
              <label for="manualMc1">MC1:</label>
              <select
                id="manualMc1"
                v-model.number="manualMc1Color"
                class="compact-select"
              >
                <option :value="-1">Auto ($D022)</option>
                <option
                  v-for="c in c64ColorOptions"
                  :key="'mc1' + c.value"
                  :value="c.value"
                >
                  {{ c.label }}
                </option>
              </select>
              <label for="manualMc2">MC2:</label>
              <select
                id="manualMc2"
                v-model.number="manualMc2Color"
                class="compact-select"
              >
                <option :value="-1">Auto ($D023)</option>
                <option
                  v-for="c in c64ColorOptions"
                  :key="'mc2' + c.value"
                  :value="c.value"
                >
                  {{ c.label }}
                </option>
              </select>
            </template>
          </div>
        </div>
        <div
          class="screen-canvas-container"
          @mousedown="onScreenMouseDown"
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
            v-if="selectedScreenRect"
            class="screen-selection-rect"
            :style="{
              top: (selectedScreenRect.minRow / 25) * 100 + '%',
              left: (selectedScreenRect.minCol / 40) * 100 + '%',
              width:
                ((selectedScreenRect.maxCol - selectedScreenRect.minCol + 1) /
                  40) *
                  100 +
                '%',
              height:
                ((selectedScreenRect.maxRow - selectedScreenRect.minRow + 1) /
                  25) *
                  100 +
                '%',
            }"
            title="Selected screen area"
          ></div>
          <div
            v-if="isDraggingScreen && screenDragRect"
            class="screen-selection-marquee"
            :style="{
              top: (screenDragRect.minRow / 25) * 100 + '%',
              left: (screenDragRect.minCol / 40) * 100 + '%',
              width:
                ((screenDragRect.maxCol - screenDragRect.minCol + 1) / 40) *
                  100 +
                '%',
              height:
                ((screenDragRect.maxRow - screenDragRect.minRow + 1) / 25) *
                  100 +
                '%',
            }"
          ></div>
          <template v-if="!selectedScreenRect">
            <div
              v-for="(cell, idx) in instancesOfSelectedCharset"
              :key="'sel-inst-' + idx"
              class="screen-selected-overlay"
              :style="{
                top: (cell.row / 25) * 100 + '%',
                left: (cell.col / 40) * 100 + '%',
                width: 100 / 40 + '%',
                height: 100 / 25 + '%',
              }"
              :title="`Char $${formatHex(cell.charCode, 2)} (${
                cell.charCode
              }) at col ${cell.col}, row ${cell.row}`"
            ></div>
          </template>
          <div
            v-if="hoveredScreenCell && !isDraggingScreen"
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
          ></div>
          <template
            v-else-if="
              instancesOfHoveredCharset.length > 0 && !isDraggingScreen
            "
          >
            <div
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
          </template>
        </div>
      </div>
    </CollapsibleTile>

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

          <template v-if="hasSelection">
            <span class="selection-badge">
              Selected: {{ selectedCharCodes.length }} char{{
                selectedCharCodes.length === 1 ? "" : "s"
              }}
            </span>
            <button
              class="nav-btn clear-selection-btn"
              title="Clear selection (Esc)"
              @click="clearSelection"
            >
              Clear
            </button>
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

          <label for="charsetManualMem">Mem:</label>
          <select
            id="charsetManualMem"
            v-model="charsetManualMem"
            class="control-select"
            title="Auto: $1000-$1FFF, $9000-$9FFF and $D000-$DFFF read the Character ROM, everything else RAM. RAM/Char ROM force the memory read."
          >
            <option value="auto">Auto</option>
            <option value="ram">RAM</option>
            <option value="rom">Char ROM</option>
          </select>

          <button class="nav-btn" @click="refreshCharsetData">Refresh</button>
        </div>
      </div>
      <div class="charset-grid-container" @click.self="clearSelection">
        <div
          class="charset-grid"
          @mousemove="onCharsetGridMouseMove"
          @click.self="clearSelection"
        >
          <div
            v-for="i in 256"
            :key="i - 1"
            class="char-cell"
            :class="{
              'highlight-from-screen': hoveredScreenCell?.charCode === i - 1,
              'char-selected': isCharSelected(i - 1),
              'in-drag-rect': isDraggingCharset && isCharInDragRect(i - 1),
            }"
            :data-index="i - 1"
            :title="'Char $' + formatHex(i - 1, 2) + ' (' + (i - 1) + ')'"
            @mouseenter="onCharsetCellMouseEnter(i - 1)"
            @mouseleave="onCharsetCellMouseLeave"
            @mousedown="onCharsetMouseDown($event, i - 1)"
          >
            <div class="char-label">{{ formatHex(i - 1, 2) }}</div>
            <canvas
              :ref="(el) => setCharsetCanvasRef(el as HTMLCanvasElement | null, i - 1)"
              width="16"
              height="16"
              class="char-canvas"
              title="Right-click to copy this character as an image"
              @contextmenu.prevent="openCharsetContextMenu($event, i - 1)"
            ></canvas>
          </div>
        </div>
      </div>

      <div
        v-if="charsetContextMenuVisible"
        class="charset-context-menu"
        :style="{
          left: charsetContextMenuX + 'px',
          top: charsetContextMenuY + 'px',
        }"
        @click.stop
      >
        <button class="charset-context-menu-item" @click="copyCharsetImage">
          Copy image
        </button>
      </div>
    </CollapsibleTile>

    <CollapsibleTile
      title="VICE Screenshot"
      storageKey="screenshot"
      class="flex-grow-tile"
    >
      <div class="screenshot-viewer">
        <div class="control-row">
          <button @click="refreshScreenshot">Refresh</button>
        </div>
        <div class="screenshot-container" v-if="screenshotData">
          <img
            :src="'data:image/png;base64,' + screenshotData"
            class="screenshot-img"
            alt="VICE Screenshot"
          />
        </div>
        <div v-else>
          <em>Click Refresh to capture screenshot</em>
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
  onBeforeUnmount,
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
    const findBankId = (name: string): number | undefined => {
      const bank = availableBanks.value.find(
        (b: { id: number; name: string }) => b.name === name
      );
      return bank?.id;
    };

    const getPreferredBankId = (...names: string[]): number => {
      for (const name of names) {
        const id = findBankId(name);
        if (id !== undefined) return id;
      }
      return 0;
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
        const memBytes: number[] = [];
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
      } catch {
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
        const offset = memoryOffset.value.replace(/[$]/g, "");
        const parsed = parseInt(offset, 16);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 0xffff) {
          baseOffset.value = parsed;
          requestMemory();
        }
      } catch {
        // Invalid input, ignore
      }
    };

    const setMemoryBaseAddress = (addr: number) => {
      if (addr >= 0 && addr <= 0xffff) {
        baseOffset.value = addr;
        memoryOffset.value = addr.toString(16).toUpperCase().padStart(4, "0");
        previousMemory.value = [];
        previousBaseOffset.value = addr;
        requestMemory();
      }
    };

    const parseHexOrDefault = (value: string, fallback: number): number => {
      const parsed = parseInt(value.replace(/[$]/g, ""), 16);
      return isNaN(parsed) ? fallback : parsed;
    };

    const navigateMemory = (delta: number) => {
      setMemoryBaseAddress(baseOffset.value + delta);
    };

    const getCurrentScreenBaseAddress = (): number => {
      if (screenSource.value === "manual") {
        return parseHexOrDefault(manualScreenAddr.value, 0x0400);
      }

      const d018 = vicRegs.value[0x18] ?? 0x14;
      return vicBankBaseAddress.value + ((d018 >> 4) & 0x0f) * 1024;
    };

    const getCurrentColorBaseAddress = (): number => {
      if (screenSource.value === "manual") {
        return parseHexOrDefault(manualColorAddr.value, 0xd800);
      }
      return 0xd800;
    };

    const getCurrentCharsetBaseAddress = (): number => {
      if (screenSource.value === "manual") {
        return parseHexOrDefault(
          manualCharsetAddr.value,
          effectiveScreenMode.value.startsWith("bitmap") ? 0x2000 : 0x1000
        );
      }

      const d018 = vicRegs.value[0x18] ?? 0x14;
      const bankBase = vicBankBaseAddress.value;

      if (effectiveScreenMode.value.startsWith("bitmap")) {
        return bankBase + ((d018 >> 3) & 0x01) * 0x2000;
      }

      return bankBase + ((d018 >> 1) & 0x07) * 2048;
    };

    const jumpToMemoryRegion = (
      region: "screen" | "color" | "charset" | "sprites" | "vic" | "sid"
    ) => {
      let addr = 0x0400;

      switch (region) {
        case "screen":
          addr = getCurrentScreenBaseAddress();
          break;
        case "color":
          addr = getCurrentColorBaseAddress();
          break;
        case "charset":
          addr = getCurrentCharsetBaseAddress();
          break;
        case "sprites":
          addr = getCurrentScreenBaseAddress() + 0x03f8;
          break;
        case "vic":
          addr = 0xd000;
          break;
        case "sid":
          addr = 0xd400;
          break;
      }

      setMemoryBaseAddress(addr);
    };

    const jumpToScreenMemory = () => {
      jumpToMemoryRegion("screen");
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
      const memBytes: number[] = [];
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

        const asciiChars: string[] = [];

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
      const value = input.value.replace(/[$]/g, "").trim();

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
      } catch {
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
      } catch {
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

    // Screen viewer controls
    const screenSource = ref<"vic" | "manual">("vic");
    const screenMode = ref<
      "auto" | "text-sc" | "text-mc" | "text-ecm" | "bitmap-sc" | "bitmap-mc"
    >("auto");
    const manualScreenAddr = ref("0400");
    const manualColorAddr = ref("D800");
    const manualCharsetAddr = ref("1000");
    // Which memory the manual charset/bitmap address is read from.
    const manualCharsetMem = ref<"auto" | "ram" | "rom">("auto");
    // Manual color overrides for the Screen Viewer (-1 = use the VIC-II register).
    const manualBgColor = ref(-1);
    const manualMc1Color = ref(-1);
    const manualMc2Color = ref(-1);
    // True when the last render of the Screen Viewer produced a single flat color.
    const screenRenderedUniform = ref(false);

    // VIC-II registers and sprite memory from store
    const vicRegs = computed(() => store.state.VicRegs || Array(47).fill(0)); // $D000-$D02E

    // When mode is "auto", derive the rendering mode from the actual VIC registers.
    // $D011 bit 6 = ECM (extended background color mode),
    // $D011 bit 5 = BMM (bitmap mode), $D016 bit 4 = MCM (multicolor mode).
    // In text-mc mode, color RAM bit 3 is then checked per-character to decide
    // whether a given character uses multicolor or single-color rendering.
    const effectiveScreenMode = computed(() => {
      if (screenMode.value === "auto") {
        const d011 = vicRegs.value[0x11] ?? 0x1b; // $D011
        const d016 = vicRegs.value[0x16] ?? 0; // $D016
        const ecm = (d011 >> 6) & 1; // Bit 6 = Extended background color mode
        const bmm = (d011 >> 5) & 1; // Bit 5 = Bitmap mode
        const mcm = (d016 >> 4) & 1; // Bit 4 = Multicolor mode
        if (bmm) return mcm ? "bitmap-mc" : "bitmap-sc";
        if (ecm) return "text-ecm";
        return mcm ? "text-mc" : "text-sc";
      }
      return screenMode.value;
    });

    const normalizeScreenCharCode = (rawCode: number): number => {
      return effectiveScreenMode.value === "text-ecm"
        ? rawCode & 0x3f
        : rawCode;
    };

    const instancesOfHoveredCharset = computed(() => {
      if (hoveredCharsetChar.value === null) return [];
      const screenMem = screenMemoryFromStore.value;
      const isEcm = effectiveScreenMode.value === "text-ecm";
      const chars = [];
      for (let i = 0; i < screenMem.length; i++) {
        const code = isEcm ? screenMem[i] & 0x3f : screenMem[i];
        if (code === hoveredCharsetChar.value) {
          chars.push({ col: i % 40, row: Math.floor(i / 40) });
        }
      }
      return chars;
    });

    // Persistent selection state between Character Map and Screen Viewer
    const selectedCharCodes = ref<number[]>([]);
    const selectedScreenRect = ref<{
      minCol: number;
      maxCol: number;
      minRow: number;
      maxRow: number;
    } | null>(null);

    const isCharSelected = (code: number) => {
      return selectedCharCodes.value.includes(code);
    };

    const hasSelection = computed(() => {
      return (
        selectedCharCodes.value.length > 0 || selectedScreenRect.value !== null
      );
    });

    const clearSelection = () => {
      selectedCharCodes.value = [];
      selectedScreenRect.value = null;
    };

    const instancesOfSelectedCharset = computed(() => {
      if (selectedCharCodes.value.length === 0) return [];
      const selectedSet = new Set(selectedCharCodes.value);
      // When multiple characters are selected, do not flood the screen with blank spaces
      const shouldIgnoreSpace =
        selectedCharCodes.value.length > 1 && selectedSet.has(32);
      const isEcm = effectiveScreenMode.value === "text-ecm";
      const screenMem = screenMemoryFromStore.value;
      const chars: { col: number; row: number; charCode: number }[] = [];
      for (let i = 0; i < screenMem.length; i++) {
        const code = isEcm ? screenMem[i] & 0x3f : screenMem[i];
        if (shouldIgnoreSpace && code === 32) continue;
        if (selectedSet.has(code)) {
          chars.push({ col: i % 40, row: Math.floor(i / 40), charCode: code });
        }
      }
      return chars;
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
        .map((_, i) => (vicRegs.value[0x27 + i] ?? 1) & 0x0f);
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

    const colorCss = (index: number): string => c64Colors[index & 0x0f];

    // VIC-II state resolved from the last snapshot ($D011/$D016/$D018/$D012 and $DD00).
    const vicStatus = computed(() => {
      const regs = vicRegs.value;
      const d011 = regs[0x11] ?? 0x1b;
      const d016 = regs[0x16] ?? 0;
      const d018 = regs[0x18] ?? 0x14;
      const bank = 3 - (cia2Base.value & 3);
      const bankBase = bank * 0x4000;
      const isBitmap = effectiveScreenMode.value.startsWith("bitmap");
      const screenAddr = bankBase + ((d018 >> 4) & 0x0f) * 0x0400;
      const charsetAddr = isBitmap
        ? bankBase + (d018 & 0x08 ? 0x2000 : 0x0000)
        : bankBase + ((d018 >> 1) & 0x07) * 0x0800;
      const charsetInRom =
        !isBitmap &&
        ((charsetAddr >= 0x1000 && charsetAddr <= 0x1fff) ||
          (charsetAddr >= 0x9000 && charsetAddr <= 0x9fff));
      const raster = (regs[0x12] ?? 0) | (((d011 >> 7) & 1) << 8);
      return {
        bank,
        bankBase,
        screenAddr,
        charsetAddr,
        charsetInRom,
        isBitmap,
        raster,
        displayEnabled: (d011 & 0x10) !== 0,
        d011,
        d016,
        d018,
        bg: (regs[0x21] ?? 0) & 0x0f,
        mc1: (regs[0x22] ?? 0) & 0x0f,
        mc2: (regs[0x23] ?? 0) & 0x0f,
      };
    });

    // Explains why the VIC-II Auto view can be a flat color while VICE shows a picture:
    // the registers are sampled at the single raster line where the emulator was halted.
    const screenWarning = computed(() => {
      if (screenSource.value !== "vic" || !screenRenderedUniform.value) {
        return "";
      }
      const s = vicStatus.value;
      if (!s.displayEnabled) {
        return `Display is blanked ($D011 bit 4 = 0) at raster ${s.raster}.`;
      }
      const where =
        s.raster < 51 || s.raster > 250
          ? `in the border/vertical blank (raster ${s.raster})`
          : `at raster ${s.raster}`;
      return (
        `The screen renders as a single color. The VIC-II registers were sampled ${where}. ` +
        `If the program switches $D018/$DD00/$D011/$D016 with raster interrupts (split screen, ` +
        `score panel), these values may not belong to the visible playfield: halt on a playfield ` +
        `raster line (e.g. a breakpoint in the raster IRQ that sets up the playfield) or use ` +
        `Source: Manual Address.`
      );
    });

    const copyVicToManual = () => {
      const s = vicStatus.value;
      const hex4 = (v: number) => v.toString(16).toUpperCase().padStart(4, "0");
      manualScreenAddr.value = hex4(s.screenAddr);
      manualColorAddr.value = "D800";
      manualCharsetAddr.value = hex4(
        s.charsetInRom ? 0xd000 + (s.charsetAddr & 0x0fff) : s.charsetAddr
      );
      manualCharsetMem.value = s.charsetInRom ? "rom" : "ram";
      manualBgColor.value = s.bg;
      manualMc1Color.value = s.mc1;
      manualMc2Color.value = s.mc2;
      // Freeze the mode too, so later snapshots from other raster lines don't change it.
      screenMode.value = effectiveScreenMode.value as typeof screenMode.value;
      screenSource.value = "manual";
    };

    // Resolves where a manually entered charset/bitmap address is read from.
    // Returns null while the debugger memory banks are not known yet.
    const resolveManualCharsetLocation = (
      addr: number,
      mem: "auto" | "ram" | "rom",
      isBitmap: boolean
    ): { addr: number; bankId: number } | null => {
      if (availableBanks.value.length === 0) return null;
      const ramBankId = getPreferredBankId("ram", "cpu", "default");
      const inVicRomShadow =
        (addr >= 0x1000 && addr <= 0x1fff) ||
        (addr >= 0x9000 && addr <= 0x9fff);
      const inCharRom = addr >= 0xd000 && addr <= 0xdfff;
      const wantRom =
        mem === "rom" ||
        (mem === "auto" && !isBitmap && (inVicRomShadow || inCharRom));
      if (!wantRom) return { addr, bankId: ramBankId };
      const romBankId = findBankId("rom");
      if (romBankId === undefined) return { addr, bankId: ramBankId };
      return {
        addr: inVicRomShadow ? 0xd000 + (addr & 0x0fff) : addr,
        bankId: romBankId,
      };
    };

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

            const byte =
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

            const byte =
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

    const isDraggingScreen = ref(false);
    const screenDragStart = ref<{ col: number; row: number } | null>(null);
    const screenDragCurrent = ref<{ col: number; row: number } | null>(null);

    const screenDragRect = computed(() => {
      if (!screenDragStart.value || !screenDragCurrent.value) {
        return null;
      }
      return {
        minCol: Math.min(
          screenDragStart.value.col,
          screenDragCurrent.value.col
        ),
        maxCol: Math.max(
          screenDragStart.value.col,
          screenDragCurrent.value.col
        ),
        minRow: Math.min(
          screenDragStart.value.row,
          screenDragCurrent.value.row
        ),
        maxRow: Math.max(
          screenDragStart.value.row,
          screenDragCurrent.value.row
        ),
      };
    });

    const getScreenColRow = (event: MouseEvent, clamp = false) => {
      if (!screenCanvas.value) return null;
      const rect = screenCanvas.value.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const scaleX = screenCanvas.value.width / rect.width;
      const scaleY = screenCanvas.value.height / rect.height;
      const x = (event.clientX - rect.left) * scaleX;
      const y = (event.clientY - rect.top) * scaleY;
      if (clamp) {
        const col = Math.max(0, Math.min(39, Math.floor(x / 8)));
        const row = Math.max(0, Math.min(24, Math.floor(y / 8)));
        return { col, row };
      }
      const col = Math.floor(x / 8);
      const row = Math.floor(y / 8);
      if (col >= 0 && col < 40 && row >= 0 && row < 25) {
        return { col, row };
      }
      return null;
    };

    const onScreenMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const pos = getScreenColRow(event, false);
      if (!pos) return;
      isDraggingScreen.value = true;
      screenDragStart.value = pos;
      screenDragCurrent.value = pos;
    };

    const onScreenMouseMove = (event: MouseEvent) => {
      if (isDraggingScreen.value) {
        const pos = getScreenColRow(event, true);
        if (pos) {
          screenDragCurrent.value = pos;
        }
      } else {
        const pos = getScreenColRow(event, false);
        if (!pos) {
          hoveredScreenCell.value = null;
          return;
        }
        const screenOffset = pos.row * 40 + pos.col;
        const rawCode = screenMemoryFromStore.value[screenOffset];
        if (rawCode !== undefined) {
          hoveredScreenCell.value = {
            col: pos.col,
            row: pos.row,
            charCode: normalizeScreenCharCode(rawCode),
          };
          return;
        }
        hoveredScreenCell.value = null;
      }
    };

    const onScreenMouseLeave = () => {
      if (!isDraggingScreen.value) {
        hoveredScreenCell.value = null;
      }
    };

    const onScreenMouseUp = (event: MouseEvent) => {
      if (!isDraggingScreen.value) return;
      const rect = screenDragRect.value;
      isDraggingScreen.value = false;
      screenDragStart.value = null;
      screenDragCurrent.value = null;
      if (!rect) return;

      const screenMem = screenMemoryFromStore.value;
      const charsInRect = new Set<number>();
      for (let r = rect.minRow; r <= rect.maxRow; r++) {
        for (let c = rect.minCol; c <= rect.maxCol; c++) {
          const offset = r * 40 + c;
          const code = screenMem[offset];
          if (code !== undefined) {
            charsInRect.add(normalizeScreenCharCode(code));
          }
        }
      }

      const newCodes = Array.from(charsInRect);
      const isSingleClick =
        rect.minCol === rect.maxCol && rect.minRow === rect.maxRow;

      // Single click on an already-selected single cell without modifiers toggles it off
      if (
        !event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        isSingleClick &&
        selectedScreenRect.value &&
        selectedScreenRect.value.minCol === rect.minCol &&
        selectedScreenRect.value.minRow === rect.minRow &&
        selectedScreenRect.value.maxCol === rect.maxCol &&
        selectedScreenRect.value.maxRow === rect.maxRow
      ) {
        clearSelection();
        return;
      }

      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        if (isSingleClick && newCodes.length === 1) {
          const singleCode = newCodes[0];
          if (selectedCharCodes.value.includes(singleCode)) {
            selectedCharCodes.value = selectedCharCodes.value.filter(
              (c) => c !== singleCode
            );
          } else {
            selectedCharCodes.value = [...selectedCharCodes.value, singleCode];
          }
        } else {
          const merged = new Set([...selectedCharCodes.value, ...newCodes]);
          selectedCharCodes.value = Array.from(merged);
        }
        selectedScreenRect.value = rect;
      } else {
        selectedCharCodes.value = newCodes;
        selectedScreenRect.value = rect;
      }
    };

    // C64 screen viewer - renders 40x25 character screen
    const renderScreen = () => {
      if (!screenCanvas.value) return;

      const ctx = screenCanvas.value.getContext("2d");
      if (!ctx) return;

      const screenMem = screenMemoryFromStore.value;
      const colorMem = colorMemoryFromStore.value;
      const charMem = charsetMemoryFromStore.value;
      const isManualSource = screenSource.value === "manual";
      const pickColor = (override: number, register: number) =>
        isManualSource && override >= 0 ? override : register;
      const bgColor = pickColor(manualBgColor.value, backgroundColor.value);
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
            const fgColor = (colorMem[screenOffset] ?? 1) & 0x0f;
            const charOffset = charCode * 8;

            for (let charRow = 0; charRow < 8; charRow++) {
              const charByte = charMem[charOffset + charRow] ?? 0;
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
      } else if (mode === "text-ecm") {
        // Extended Background Color Mode ($D011 bit 6 = 1):
        // Upper 2 bits of screen byte select background register $D021-$D024;
        // lower 6 bits select character glyph 0-63.
        const ecmBg = [
          bgColor & 0x0f,
          (vicRegs.value[0x22] ?? 0) & 0x0f,
          (vicRegs.value[0x23] ?? 0) & 0x0f,
          (vicRegs.value[0x24] ?? 0) & 0x0f,
        ];

        for (let row = 0; row < 25; row++) {
          for (let col = 0; col < 40; col++) {
            const screenOffset = row * 40 + col;
            const rawByte = screenMem[screenOffset] ?? 0;
            const cellBg = ecmBg[(rawByte >> 6) & 0x03];
            const charOffset = (rawByte & 0x3f) * 8;
            const fgColor = (colorMem[screenOffset] ?? 1) & 0x0f;

            ctx.fillStyle = c64Colors[cellBg];
            ctx.fillRect(col * 8, row * 8, 8, 8);

            for (let charRow = 0; charRow < 8; charRow++) {
              const charByte = charMem[charOffset + charRow] ?? 0;
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
      } else if (mode === "text-mc") {
        // Text mode, multicolor
        const mc1 = pickColor(manualMc1Color.value, vicRegs.value[0x22] ?? 0); // $D022
        const mc2 = pickColor(manualMc2Color.value, vicRegs.value[0x23] ?? 0); // $D023

        for (let row = 0; row < 25; row++) {
          for (let col = 0; col < 40; col++) {
            const screenOffset = row * 40 + col;
            const charCode = screenMem[screenOffset] ?? 0;
            // Mask upper open-bus nibble from VICE Color RAM ($D800-$DBE7) before checking bit 3
            const colorNibble = (colorMem[screenOffset] ?? 1) & 0x0f;
            const charOffset = charCode * 8;
            const isMulticolor = (colorNibble & 0x08) !== 0; // Bit 3 set = multicolor

            for (let charRow = 0; charRow < 8; charRow++) {
              const charByte = charMem[charOffset + charRow] ?? 0;

              if (isMulticolor) {
                // Multicolor: 2 bits per pixel, 4 pixel pairs per row
                // Use only bits 0-2 of color RAM for the character color
                const mcCharColor = colorNibble & 0x07;
                for (let pixelPair = 0; pixelPair < 4; pixelPair++) {
                  const bitPair = (charByte >> (6 - pixelPair * 2)) & 0x03;
                  let color = bgColor;
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
                for (let charCol = 0; charCol < 8; charCol++) {
                  const bit = (charByte >> (7 - charCol)) & 1;
                  if (bit) {
                    ctx.fillStyle = c64Colors[colorNibble];
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
        // Bitmap mode, multicolor (160x200):
        // %00 = $D021 background, %01 = screen RAM high nibble,
        // %10 = screen RAM low nibble, %11 = color RAM low nibble
        for (let y = 0; y < 200; y++) {
          const charRow = Math.floor(y / 8);
          const pixelRow = y % 8;

          for (let x = 0; x < 40; x++) {
            const screenOffset = charRow * 40 + x;
            const screenByte = screenMem[screenOffset] ?? 0;
            const screenHigh = (screenByte >> 4) & 0x0f;
            const screenLow = screenByte & 0x0f;
            const colorRamLow = (colorMem[screenOffset] ?? 0) & 0x0f;

            const bitmapOffset = charRow * 320 + x * 8 + pixelRow;
            const bitmapByte = charMem[bitmapOffset] ?? 0;

            // 4 pixel pairs per byte (2 bits each)
            for (let pixelPair = 0; pixelPair < 4; pixelPair++) {
              const bitPair = (bitmapByte >> (6 - pixelPair * 2)) & 0x03;
              let color = bgColor;
              switch (bitPair) {
                case 0:
                  color = bgColor;
                  break;
                case 1:
                  color = screenHigh;
                  break;
                case 2:
                  color = screenLow;
                  break;
                case 3:
                  color = colorRamLow;
                  break;
              }
              ctx.fillStyle = c64Colors[color & 0x0f];
              ctx.fillRect(x * 8 + pixelPair * 2, y, 2, 1);
            }
          }
        }
      }

      // Detect a flat single-color result so the UI can explain likely causes.
      const pixels = ctx.getImageData(0, 0, 320, 200).data;
      let uniform = true;
      for (let p = 4; p < pixels.length; p += 4) {
        if (
          pixels[p] !== pixels[0] ||
          pixels[p + 1] !== pixels[1] ||
          pixels[p + 2] !== pixels[2]
        ) {
          uniform = false;
          break;
        }
      }
      screenRenderedUniform.value = uniform;
    };

    // Watch for changes to screen data or mode
    watch(
      [
        screenMemoryFromStore,
        colorMemoryFromStore,
        charsetMemoryFromStore,
        backgroundColor,
        screenMode,
        screenSource,
        manualBgColor,
        manualMc1Color,
        manualMc2Color,
      ],
      () => {
        renderScreen();
      },
      { deep: true }
    );

    watch(
      [vicRegs, cia2Base],
      () => {
        // In VIC-II Auto + Auto mode the backend pushes a consistent snapshot
        // (registers + screen + color + charset read in one halt): just re-render.
        // Re-fetch only when the forced mode needs other lengths, or in manual mode
        // (new registers mean the debugger stopped again).
        if (screenSource.value === "manual" || screenMode.value !== "auto") {
          refreshScreenData();
        }
        renderScreen();
      },
      { deep: true }
    );

    watch(
      [
        screenSource,
        screenMode,
        manualCharsetMem,
        () => availableBanks.value.length,
      ],
      () => {
        if (screenSource.value === "vic" && screenMode.value === "auto") {
          // Let the backend resolve everything from one consistent halt instead of
          // fetching with possibly stale VIC registers from the webview.
          requestSnapshot();
        } else {
          refreshScreenData();
        }
        renderScreen();
      }
    );

    // Ask the extension for one atomic VIC-II/screen/charset snapshot (debounced).
    let snapshotTimer: number | null = null;
    const requestSnapshot = () => {
      if (!vscode || snapshotTimer !== null) return;
      snapshotTimer = window.setTimeout(() => {
        snapshotTimer = null;
        vscode.postMessage({ command: "requestState", forceSnapshot: true });
      }, 30);
    };

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

        if (availableBanks.value.length === 0) {
          vscode.postMessage({ command: "getBanks" });
          return;
        }

        if (screenSource.value === "manual") {
          screenAddr = parseInt(manualScreenAddr.value.replace(/[$]/g, ""), 16);
          colorAddr = parseInt(manualColorAddr.value.replace(/[$]/g, ""), 16);
          charsetAddr = parseInt(
            manualCharsetAddr.value.replace(/[$]/g, ""),
            16
          );
          if (isNaN(screenAddr) || isNaN(colorAddr) || isNaN(charsetAddr)) {
            return;
          }

          // Screen/charset come from RAM (what the VIC-II sees, independent of the
          // CPU port $01); color RAM lives in the I/O area.
          screenBankId = getPreferredBankId("ram", "cpu", "default");
          colorBankId = getPreferredBankId("io", "cpu", "default");
          const resolved = resolveManualCharsetLocation(
            charsetAddr,
            manualCharsetMem.value,
            effectiveScreenMode.value.startsWith("bitmap")
          );
          if (!resolved) {
            vscode.postMessage({ command: "getBanks" });
            return;
          }
          charsetAddr = resolved.addr;
          charsetBankId = resolved.bankId;
        } else {
          // Auto mode: calculate from VIC-II registers
          const d018 = vicRegs.value[0x18] ?? 0x14;
          const baseAddress = vicBankBaseAddress.value;
          const isBitmapMode = effectiveScreenMode.value.startsWith("bitmap");

          // Inside the VIC-II's 16KB window:
          // Screen memory is at offset ((D018 >> 4) & 0x0F) * 1024
          screenAddr = baseAddress + ((d018 >> 4) & 0x0f) * 1024;
          // Bitmap memory uses D018 bit 3 (offset $0000 or $2000);
          // charset memory uses ((D018 >> 1) & 0x07) * 2048.
          charsetAddr = isBitmapMode
            ? baseAddress + (d018 & 0x08 ? 0x2000 : 0x0000)
            : baseAddress + ((d018 >> 1) & 0x07) * 2048;

          // Color RAM is always at D800 in CPU space
          colorAddr = 0xd800;

          // Standard VICE monitor has no "vicii" bank, we access it from "ram"
          // or fallback to "cpu" which is essentially Bank 0 in the debug protocol
          screenBankId = getPreferredBankId("ram", "cpu", "default");
          colorBankId = getPreferredBankId("io", "cpu", "default");

          // In text modes, if charset points to the Character ROM shadow
          // (0x1000-0x1FFF or 0x9000-0x9FFF in VIC-II space), map to "rom" bank at 0xD000.
          if (
            !isBitmapMode &&
            ((charsetAddr >= 0x1000 && charsetAddr <= 0x1fff) ||
              (charsetAddr >= 0x9000 && charsetAddr <= 0x9fff))
          ) {
            const romBankId = findBankId("rom");
            if (romBankId === undefined) {
              vscode.postMessage({ command: "getBanks" });
              return;
            }
            charsetAddr = 0xd000 + (charsetAddr & 0x0fff);
            charsetBankId = romBankId;
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
          const bankId = getPreferredBankId("ram", "cpu", "default");
          // Sprite pointers are always relative to the VIC-II's current 16KB bank.
          const baseAddress = vicBankBaseAddress.value;
          newPointers.forEach((ptr: number, idx: number) => {
            const addr = baseAddress + ptr * 64;
            queueGetMemory(addr, addr + 63, bankId, `spriteData:${idx}`);
          });
        }
      },
      { deep: true, immediate: true }
    );

    // Request VIC-II registers and sprite data from debugger. The extension reads
    // registers, sprite pointers, screen, color RAM and charset in a single halt.
    const requestSpriteData = () => {
      requestSnapshot();
    };

    const charsetSource = ref<"vic" | "manual">("vic");
    const charsetMode = ref<"auto" | "single" | "multi">("auto");
    const charsetManualMem = ref<"auto" | "ram" | "rom">("auto");
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

    const charsetContextMenuVisible = ref(false);
    const charsetContextMenuX = ref(0);
    const charsetContextMenuY = ref(0);
    const charsetContextCharIndex = ref<number | null>(null);

    const closeCharsetContextMenu = () => {
      charsetContextMenuVisible.value = false;
      charsetContextCharIndex.value = null;
    };

    const onCharsetContextMenuKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (charsetContextMenuVisible.value) {
          closeCharsetContextMenu();
        } else if (hasSelection.value) {
          clearSelection();
        }
      }
    };

    const isDraggingCharset = ref(false);
    const charsetDragStart = ref<{ col: number; row: number } | null>(null);
    const charsetDragCurrent = ref<{ col: number; row: number } | null>(null);

    const charsetDragRect = computed(() => {
      if (!charsetDragStart.value || !charsetDragCurrent.value) {
        return null;
      }
      return {
        minCol: Math.min(
          charsetDragStart.value.col,
          charsetDragCurrent.value.col
        ),
        maxCol: Math.max(
          charsetDragStart.value.col,
          charsetDragCurrent.value.col
        ),
        minRow: Math.min(
          charsetDragStart.value.row,
          charsetDragCurrent.value.row
        ),
        maxRow: Math.max(
          charsetDragStart.value.row,
          charsetDragCurrent.value.row
        ),
      };
    });

    const isCharInDragRect = (code: number) => {
      const rect = charsetDragRect.value;
      if (!rect) return false;
      const col = code % 16;
      const row = Math.floor(code / 16);
      return (
        col >= rect.minCol &&
        col <= rect.maxCol &&
        row >= rect.minRow &&
        row <= rect.maxRow
      );
    };

    const onCharsetMouseDown = (event: MouseEvent, code: number) => {
      if (event.button !== 0) return;
      event.preventDefault();
      isDraggingCharset.value = true;
      const col = code % 16;
      const row = Math.floor(code / 16);
      charsetDragStart.value = { col, row };
      charsetDragCurrent.value = { col, row };
    };

    const onCharsetCellMouseEnter = (code: number) => {
      hoveredCharsetChar.value = code;
      if (isDraggingCharset.value) {
        const col = code % 16;
        const row = Math.floor(code / 16);
        charsetDragCurrent.value = { col, row };
      }
    };

    const onCharsetCellMouseLeave = () => {
      hoveredCharsetChar.value = null;
    };

    const onCharsetGridMouseMove = (event: MouseEvent) => {
      if (!isDraggingCharset.value) return;
      const target = (event.target as HTMLElement)?.closest(
        ".char-cell"
      ) as HTMLElement | null;
      if (target && target.dataset.index !== undefined) {
        const idx = parseInt(target.dataset.index, 10);
        if (!isNaN(idx)) {
          charsetDragCurrent.value = {
            col: idx % 16,
            row: Math.floor(idx / 16),
          };
        }
      }
    };

    const onCharsetMouseUp = (event: MouseEvent) => {
      if (!isDraggingCharset.value) return;
      const rect = charsetDragRect.value;
      isDraggingCharset.value = false;
      charsetDragStart.value = null;
      charsetDragCurrent.value = null;
      if (!rect) return;

      const codesInRect: number[] = [];
      for (let r = rect.minRow; r <= rect.maxRow; r++) {
        for (let c = rect.minCol; c <= rect.maxCol; c++) {
          codesInRect.push(r * 16 + c);
        }
      }

      const isSingleClick =
        rect.minCol === rect.maxCol && rect.minRow === rect.maxRow;

      // Single click on an already-selected single character without modifiers toggles it off
      if (
        !event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        isSingleClick &&
        selectedCharCodes.value.length === 1 &&
        selectedCharCodes.value[0] === codesInRect[0]
      ) {
        clearSelection();
        return;
      }

      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        if (isSingleClick) {
          const singleCode = codesInRect[0];
          if (selectedCharCodes.value.includes(singleCode)) {
            selectedCharCodes.value = selectedCharCodes.value.filter(
              (c) => c !== singleCode
            );
          } else {
            selectedCharCodes.value = [...selectedCharCodes.value, singleCode];
          }
        } else {
          const merged = new Set([...selectedCharCodes.value, ...codesInRect]);
          selectedCharCodes.value = Array.from(merged);
        }
      } else {
        selectedCharCodes.value = codesInRect;
      }
      selectedScreenRect.value = null;
    };

    const onGlobalMouseMove = (event: MouseEvent) => {
      if (isDraggingScreen.value) {
        onScreenMouseMove(event);
      }
      if (isDraggingCharset.value) {
        onCharsetGridMouseMove(event);
      }
    };

    const onGlobalMouseUp = (event: MouseEvent) => {
      if (isDraggingScreen.value) {
        onScreenMouseUp(event);
      }
      if (isDraggingCharset.value) {
        onCharsetMouseUp(event);
      }
    };

    const openCharsetContextMenu = (event: MouseEvent, index: number) => {
      const menuWidth = 140;
      const menuHeight = 32;

      charsetContextCharIndex.value = index;
      charsetContextMenuX.value = Math.max(
        0,
        Math.min(event.clientX, window.innerWidth - menuWidth)
      );
      charsetContextMenuY.value = Math.max(
        0,
        Math.min(event.clientY, window.innerHeight - menuHeight)
      );
      charsetContextMenuVisible.value = true;
    };

    const copyCharsetImage = async () => {
      const index = charsetContextCharIndex.value;
      closeCharsetContextMenu();

      if (index === null) return;

      const canvas = charsetCanvasRefs.value[index];
      if (!canvas) return;

      try {
        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob(resolve, "image/png");
        });

        if (!blob) return;

        if (
          navigator.clipboard &&
          typeof navigator.clipboard.write === "function" &&
          typeof window.ClipboardItem !== "undefined"
        ) {
          await navigator.clipboard.write([
            new window.ClipboardItem({ "image/png": blob }),
          ]);
          return;
        }

        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(canvas.toDataURL("image/png"));
        }
      } catch (err) {
        console.error("Failed to copy charset image:", err);
      }
    };

    const charsetTileMemoryFromStore = computed(() =>
      charsetSource.value === "vic"
        ? store.state.VicCharsetTileMemory || new Uint8Array(2048)
        : store.state.CharsetTileMemory || new Uint8Array(2048)
    );

    const isTextMulticolorEnabled = computed(
      () => effectiveScreenMode.value === "text-mc"
    );

    const charsetEffectiveMode = computed(() => {
      if (charsetMode.value === "auto") {
        return isTextMulticolorEnabled.value ? "multi" : "single";
      }
      return charsetMode.value;
    });

    const resolveCharsetSource = () => {
      let addr = 0x1000;
      let bankId = getPreferredBankId("ram", "cpu", "default");

      if (charsetSource.value === "manual") {
        addr = parseInt(charsetManualAddr.value.replace(/[$]/g, ""), 16);
        if (isNaN(addr)) addr = 0x1000;

        // Auto accepts the common VIC-visible ROM addresses ($1000/$1800/$9000/$9800)
        // and $D000-$DFFF as Character ROM; RAM/Char ROM force the memory read so
        // custom charsets in RAM under $D000 (VIC bank 3) can be inspected too.
        const resolved = resolveManualCharsetLocation(
          addr,
          charsetManualMem.value,
          false
        );
        if (!resolved) {
          vscode?.postMessage({ command: "getBanks" });
          return { addr, bankId };
        }
        return resolved;
      }

      const d011 = vicRegs.value[0x11] ?? 0x1b;
      const d018 = vicRegs.value[0x18] ?? 0x14;
      const baseAddress = vicBankBaseAddress.value;
      const isBitmapMode = ((d011 >> 5) & 1) === 1;

      addr = isBitmapMode
        ? baseAddress + (d018 & 0x08 ? 0x2000 : 0x0000)
        : baseAddress + ((d018 >> 1) & 0x07) * 2048;
      bankId = getPreferredBankId("ram", "cpu", "default");

      if (
        !isBitmapMode &&
        ((addr >= 0x1000 && addr <= 0x1fff) ||
          (addr >= 0x9000 && addr <= 0x9fff))
      ) {
        const romBankId = findBankId("rom");
        if (romBankId === undefined) {
          vscode?.postMessage({ command: "getBanks" });
          return { addr, bankId };
        }
        return {
          addr: 0xd000 + (addr & 0x0fff),
          bankId: romBankId,
        };
      }

      return { addr, bankId };
    };

    const renderCharsetGrid = () => {
      const charMem = charsetTileMemoryFromStore.value;
      const screenMem = screenMemoryFromStore.value;
      const colorMem = colorMemoryFromStore.value;
      const multicolorChars = new Set<number>();
      const charForegrounds = new Map<number, number>();

      if (
        charsetMode.value === "auto" &&
        effectiveScreenMode.value.startsWith("text")
      ) {
        const limit = Math.min(screenMem.length, colorMem.length);
        for (let idx = 0; idx < limit; idx++) {
          const charCode = normalizeScreenCharCode(screenMem[idx]);
          const rawColorCode = colorMem[idx] & 0x0f;
          const isMulticolorCell =
            isTextMulticolorEnabled.value && (rawColorCode & 0x08) !== 0;
          const foregroundColor = isMulticolorCell
            ? rawColorCode & 0x07
            : rawColorCode & 0x0f;

          if (!charForegrounds.has(charCode)) {
            charForegrounds.set(charCode, foregroundColor);
          }

          if (isMulticolorCell) {
            multicolorChars.add(charCode);
          }
        }
      }

      const bgColorVal =
        charsetSource.value === "vic" || charsetMode.value === "auto"
          ? vicRegs.value[0x21] ?? 0
          : charsetManualBgColor.value;
      const fgColorVal = charsetManualFgColor.value;
      const mc1 =
        charsetSource.value === "vic" || charsetMode.value === "auto"
          ? vicRegs.value[0x22] ?? 0
          : charsetManualMc1Color.value;
      const mc2 =
        charsetSource.value === "vic" || charsetMode.value === "auto"
          ? vicRegs.value[0x23] ?? 0
          : charsetManualMc2Color.value;

      const bgColor = c64Colors[bgColorVal & 0x0f];
      const defaultFgColor = c64Colors[fgColorVal & 0x0f];
      const mc1Color = c64Colors[mc1 & 0x0f];
      const mc2Color = c64Colors[mc2 & 0x0f];

      for (let i = 0; i < 256; i++) {
        const canvas = charsetCanvasRefs.value[i];
        if (!canvas) continue;
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;

        const isMulti =
          charsetMode.value === "multi" ||
          (charsetMode.value === "auto" && multicolorChars.has(i));
        const fgColor =
          charsetMode.value === "auto" && charForegrounds.has(i)
            ? c64Colors[(charForegrounds.get(i) ?? 0) & 0x0f]
            : defaultFgColor;

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
      if (availableBanks.value.length === 0) {
        vscode.postMessage({ command: "getBanks" });
        return;
      }

      const { addr, bankId } = resolveCharsetSource();
      queueGetMemory(
        addr,
        addr + 2047,
        bankId,
        charsetSource.value === "vic"
          ? "vicCharsetTileMemory"
          : "charsetTileMemory"
      );
    };

    const refreshAllScreenData = () => {
      if (!vscode) return;
      if (availableBanks.value.length === 0) {
        vscode.postMessage({ command: "getBanks" });
      }
      // One atomic snapshot of VIC-II registers + screen + color + charset,
      // taken even while the program is running.
      requestSnapshot();
      if (screenSource.value === "manual" || screenMode.value !== "auto") {
        refreshScreenData();
      }
      if (charsetSource.value === "manual") {
        refreshCharsetData();
      }
    };

    // Auto-refresh memory viewer and graphics panels on debug stop/step events
    watch([() => PC.value, () => store.state.StopSeq], () => {
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
      // Fetch fresh memory. VIC-II state, screen and charset (VIC-II Auto) are pushed
      // by the extension as one consistent snapshot on every stop; fetching them here
      // too would race with it and could mix stale registers with new memory.
      requestMemory();
      if (screenSource.value === "manual") {
        refreshScreenData();
      }
      if (charsetSource.value === "manual") {
        refreshCharsetData();
      }
    });

    const refreshScreenshot = () => {
      if (vscode) {
        vscode.postMessage({
          command: "requestScreenshot",
        });
      }
    };

    watch(
      [
        charsetSource,
        charsetManualAddr,
        charsetManualMem,
        () => availableBanks.value.length,
      ],
      () => {
        if (charsetSource.value === "vic") {
          // VIC-II Auto: the backend snapshot supplies the charset consistently.
          requestSnapshot();
        } else {
          refreshCharsetData();
        }
        renderCharsetGrid();
      }
    );

    watch(
      [vicRegs, cia2Base],
      () => {
        // New registers mean a new snapshot (e.g. a debugger stop): manual charset
        // addresses must be re-read; VIC-II Auto data came with the snapshot.
        if (charsetSource.value === "manual") {
          refreshCharsetData();
        }
        renderCharsetGrid();
      },
      { deep: true }
    );

    watch(
      [
        charsetMode,
        charsetManualBgColor,
        charsetManualFgColor,
        charsetManualMc1Color,
        charsetManualMc2Color,
      ],
      () => {
        renderCharsetGrid();
      }
    );

    watch(
      [
        charsetTileMemoryFromStore,
        screenMemoryFromStore,
        colorMemoryFromStore,
        effectiveScreenMode,
      ],
      () => {
        renderCharsetGrid();
      }
    );

    if (vscode) {
      const savedState = (vscode.getState() || {}) as {
        memoryOffset?: string;
        baseOffset?: number;
        searchQuery?: string;
        spriteScale?: number;
        screenSource?: "vic" | "manual";
        screenMode?:
          | "auto"
          | "text-sc"
          | "text-mc"
          | "text-ecm"
          | "bitmap-sc"
          | "bitmap-mc";
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
        manualCharsetMem?: "auto" | "ram" | "rom";
        charsetManualMem?: "auto" | "ram" | "rom";
        manualBgColor?: number;
        manualMc1Color?: number;
        manualMc2Color?: number;
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
      if (savedState.manualCharsetMem !== undefined)
        manualCharsetMem.value = savedState.manualCharsetMem;
      if (savedState.charsetManualMem !== undefined)
        charsetManualMem.value = savedState.charsetManualMem;
      if (savedState.manualBgColor !== undefined)
        manualBgColor.value = savedState.manualBgColor;
      if (savedState.manualMc1Color !== undefined)
        manualMc1Color.value = savedState.manualMc1Color;
      if (savedState.manualMc2Color !== undefined)
        manualMc2Color.value = savedState.manualMc2Color;

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
          manualCharsetMem,
          charsetManualMem,
          manualBgColor,
          manualMc1Color,
          manualMc2Color,
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
            manualCharsetMem: manualCharsetMem.value,
            charsetManualMem: charsetManualMem.value,
            manualBgColor: manualBgColor.value,
            manualMc1Color: manualMc1Color.value,
            manualMc2Color: manualMc2Color.value,
          });
        },
        { deep: true, immediate: true }
      );
    }

    onMounted(() => {
      if (vscode) {
        vscode.postMessage({ command: "getBanks" });
        vscode.postMessage({ command: "requestState" });
      }

      window.addEventListener("click", closeCharsetContextMenu);
      window.addEventListener("blur", closeCharsetContextMenu);
      window.addEventListener("keydown", onCharsetContextMenuKeydown);
      window.addEventListener("mouseup", onGlobalMouseUp);
      window.addEventListener("mousemove", onGlobalMouseMove);

      updateSpriteCanvases();
      renderScreen();
      refreshCharsetData();
      setTimeout(() => {
        renderCharsetGrid();
      }, 100);
    });

    onBeforeUnmount(() => {
      window.removeEventListener("click", closeCharsetContextMenu);
      window.removeEventListener("blur", closeCharsetContextMenu);
      window.removeEventListener("keydown", onCharsetContextMenuKeydown);
      window.removeEventListener("mouseup", onGlobalMouseUp);
      window.removeEventListener("mousemove", onGlobalMouseMove);
    });

    return {
      hoveredScreenCell,
      hoveredCharsetChar,
      instancesOfHoveredCharset,
      selectedCharCodes,
      selectedScreenRect,
      isCharSelected,
      hasSelection,
      clearSelection,
      instancesOfSelectedCharset,
      isDraggingScreen,
      screenDragRect,
      onScreenMouseDown,
      onScreenMouseMove,
      onScreenMouseLeave,
      isDraggingCharset,
      charsetDragRect,
      isCharInDragRect,
      onCharsetMouseDown,
      onCharsetCellMouseEnter,
      onCharsetCellMouseLeave,
      onCharsetGridMouseMove,
      charsetSource,
      charsetMode,
      charsetEffectiveMode,
      charsetManualAddr,
      charsetManualBgColor,
      charsetManualFgColor,
      charsetManualMc1Color,
      charsetManualMc2Color,
      setCharsetCanvasRef,
      charsetContextMenuVisible,
      charsetContextMenuX,
      charsetContextMenuY,
      openCharsetContextMenu,
      copyCharsetImage,
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
      jumpToMemoryRegion,
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
      manualCharsetMem,
      charsetManualMem,
      manualBgColor,
      manualMc1Color,
      manualMc2Color,
      vicStatus,
      screenWarning,
      colorCss,
      copyVicToManual,
      c64ColorOptions,
      refreshScreenData,
      refreshAllScreenData,
      refreshScreenshot,
      screenshotData: computed(() => store.getters.screenshotData),
    };
  },
});
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
.registers {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  padding: 0px;
  background: var(--c64-background);
  color: var(--c64-foreground);
  font-family: var(--vscode-editor-font-family);
  font-size: 13px;
}

.register-line,
.flag-line {
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--c64-background);
  padding: 0px;
  border-radius: 3px;
  margin-bottom: 2px;
}

.line-label {
  color: var(--c64-accent);
  font-weight: bold;
  margin-right: 4px;
  font-size: 13px;
}

.label {
  color: var(--c64-label);
  font-size: 13px;
  margin-left: 2px;
}

.value {
  color: var(--c64-value);
  font-size: 13px;
}

.value.editable {
  background: transparent;
  border: 1px solid transparent;
  color: var(--c64-value);
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
  border-color: var(--c64-input-border);
  background: var(--c64-input-background);
}

.value.editable:focus {
  outline: none;
  border-color: var(--c64-focus-border);
  background: var(--c64-input-background);
}

.flag {
  display: inline-block;
  width: 16px;
  height: 16px;
  line-height: 16px;
  text-align: center;
  background: var(--c64-surface);
  border-radius: 2px;
  font-weight: bold;
  font-size: 12px;
  color: var(--c64-muted);
  transition: all 0.2s ease;
}

.flag.active {
  background: var(--c64-accent);
  color: var(--vscode-button-foreground, var(--c64-background));
  box-shadow: 0 0 0 1px var(--c64-focus-border);
}

.memory-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
  flex-wrap: wrap;
}

.memory-controls label {
  color: var(--c64-label);
  font-weight: bold;
  font-size: 13px;
}

.memory-controls input {
  background: var(--c64-input-background);
  border: 1px solid var(--c64-input-border);
  color: var(--c64-input-foreground);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: var(--vscode-editor-font-family);
  font-size: 13px;
  width: 70px;
}

.memory-controls input:focus {
  outline: none;
  border-color: var(--c64-focus-border);
}

.memory-nav-buttons {
  display: flex;
  gap: 2px;
  margin-left: 4px;
}

.memory-nav-buttons .nav-btn {
  background: var(--c64-input-background);
  border: 1px solid var(--c64-input-border);
  color: var(--c64-input-foreground);
  padding: 1px 6px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s ease;
  min-width: 24px;
}

.memory-nav-buttons .nav-btn:hover {
  background: var(--c64-hover-background);
  border-color: var(--c64-focus-border);
}

.memory-nav-buttons .nav-btn:active {
  background: var(--c64-active-background);
}

.memory-address-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.memory-address-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.memory-shortcuts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.memory-shortcut-btn {
  background: var(--c64-secondary-button-background);
  border-color: var(--c64-input-border);
  color: var(--c64-secondary-button-foreground);
  padding: 2px 8px;
}

.memory-shortcut-btn:hover {
  background: var(--c64-secondary-button-hover);
}

.memory-grid {
  background: var(--c64-background);
  border-radius: 3px;
  padding: 2px;
  border: 1px solid var(--c64-border);
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
  border-bottom: 1px solid var(--c64-border);
  margin-bottom: 2px;
  color: var(--c64-label);
  font-weight: bold;
  font-size: 12px;
  position: sticky;
  top: 0;
  background: var(--c64-background);
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
  background: var(--c64-hover-background);
}

.addr-col {
  color: var(--c64-label);
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
  color: var(--c64-value);
  min-width: 18px;
}

.editable-byte {
  background: transparent;
  border: 1px solid transparent;
  box-sizing: border-box;
  color: var(--c64-value);
  font-family: var(--vscode-editor-font-family);
  font-size: 11px;
  padding: 0;
  width: 18px;
  flex-shrink: 0;
  text-align: center;
  text-transform: uppercase;
}

.editable-byte:hover {
  border-color: var(--c64-input-border);
  background: var(--c64-input-background);
}

.editable-byte:focus {
  outline: none;
  border-color: var(--c64-focus-border);
  background: var(--c64-input-background);
}

.editable-byte.changed {
  background: var(--c64-success-background);
  border-color: var(--c64-success-foreground);
  color: var(--c64-success-foreground);
  font-weight: bold;
}

.editable-byte.changed:focus {
  background: var(--c64-success-background);
  box-shadow: 0 0 0 1px var(--c64-success-foreground);
}

.editable-byte.found {
  background: var(--c64-match-background);
  border-color: var(--c64-match-border);
  color: var(--c64-match-foreground);
  font-weight: bold;
}

.editable-byte.found:focus {
  background: var(--c64-match-background);
  box-shadow: 0 0 0 1px var(--c64-match-border);
}

.editable-byte.changed.found {
  background: var(--c64-combined-background);
  border-color: var(--c64-combined-border);
  color: var(--c64-combined-foreground);
}

.editable-byte.changed.found:focus {
  background: var(--c64-combined-background);
  box-shadow: 0 0 0 1px var(--c64-combined-border);
}

.memory-search-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  margin-left: 8px;
}

.memory-search-controls label {
  color: var(--c64-label);
  font-weight: bold;
  font-size: 13px;
  white-space: nowrap;
}

.memory-search-controls input {
  background: var(--c64-input-background);
  border: 1px solid var(--c64-input-border);
  color: var(--c64-input-foreground);
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
  border-color: var(--c64-focus-border);
  background: var(--c64-input-background);
}

.search-info {
  color: var(--c64-detail);
  font-size: 11px;
  white-space: nowrap;
  margin-left: 4px;
}

.ascii-col {
  color: var(--c64-detail);
  width: 130px;
  flex-shrink: 0;
  font-family: var(--vscode-editor-font-family);
  white-space: pre;
  font-size: 12px;
  border-left: 1px solid var(--c64-border);
  padding-left: 8px;
  margin-left: 4px;
}

.ascii-col span.highlight {
  background-color: var(--c64-selection-background);
  color: var(--c64-selection-foreground);
}

.hex-header-byte {
  display: inline-block;
  width: 18px;
  flex-shrink: 0;
  box-sizing: border-box;
  border: 1px solid transparent;
  text-align: center;
  color: var(--c64-label);
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
  color: var(--c64-label);
  font-weight: bold;
}

.sprite-scale-controls button {
  background: var(--c64-input-background);
  border: 1px solid var(--c64-input-border);
  color: var(--c64-input-foreground);
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
  background: var(--c64-hover-background);
  border-color: var(--c64-focus-border);
}

.sprite-scale-controls button:active {
  background: var(--c64-active-background);
}

.scale-value {
  color: var(--c64-value);
  min-width: 24px;
  text-align: center;
  font-family: var(--vscode-editor-font-family);
}

.sprite-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  background: var(--c64-background);
  padding: 4px;
  border-radius: 3px;
  border: 1px solid var(--c64-border);
}

.sprite-container {
  display: flex;
  flex-direction: column;
  background: var(--c64-surface);
  padding: 4px;
  border-radius: 3px;
  border: 1px solid var(--c64-border);
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
  color: var(--c64-label);
  font-weight: bold;
  font-size: 12px;
}

.sprite-info {
  color: var(--c64-detail);
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
  border: 1px solid var(--c64-border);
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
  color: var(--c64-label);
  font-weight: bold;
  width: 10px;
}

.reg-value {
  color: var(--c64-value);
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
  color: var(--c64-label);
  font-weight: bold;
  font-size: 13px;
}

.control-row select,
.control-row input {
  background: var(--c64-input-background);
  border: 1px solid var(--c64-input-border);
  color: var(--c64-input-foreground);
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
  border-color: var(--c64-focus-border);
}

.control-row select.compact-select {
  min-width: 0;
}

.vic-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 10px;
  font-size: 11px;
  font-family: var(--vscode-editor-font-family);
  color: var(--c64-detail);
}

.vic-status .nav-btn {
  font-size: 11px;
  padding: 0 6px;
}

.color-chip {
  display: inline-block;
  width: 10px;
  height: 10px;
  vertical-align: middle;
  border: 1px solid var(--c64-border);
  border-radius: 2px;
}

.vic-warning {
  font-size: 11px;
  line-height: 1.4;
  color: var(--vscode-editorWarning-foreground, #cca700);
  border-left: 3px solid var(--vscode-editorWarning-foreground, #cca700);
  padding: 2px 6px;
}

.control-row button {
  background: var(--c64-input-background);
  border: 1px solid var(--c64-input-border);
  color: var(--c64-input-foreground);
  padding: 1px 8px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s ease;
}

.control-row button:hover {
  background: var(--c64-hover-background);
  border-color: var(--c64-focus-border);
}

.control-row button:active {
  background: var(--c64-active-background);
}

.selection-badge {
  font-size: 11px;
  color: var(--c64-selection-outline, #ffd600);
  background: var(--c64-selection-fill, rgba(255, 214, 0, 0.2));
  border: 1px solid var(--c64-selection-outline, #ffd600);
  padding: 1px 6px;
  border-radius: 3px;
  margin-left: 6px;
  white-space: nowrap;
  font-weight: bold;
}

.clear-selection-btn {
  font-size: 11px;
  padding: 1px 6px;
  margin-left: 4px;
}

.clear-selection-btn:hover {
  border-color: #f48771;
  color: #f48771;
}

.screen-canvas-container {
  position: relative;
  width: 100%;
  max-width: 640px;
  line-height: 0;
  border: 2px solid var(--c64-border);
  border-radius: 3px;
  background: #000;
  box-sizing: content-box;
  user-select: none;
}

.screen-selection-rect {
  position: absolute;
  border: 2px solid var(--c64-selection-outline, #ffd600);
  outline: 1px solid #000000;
  box-shadow: 0 0 0 1px #000000,
    0 0 8px var(--c64-selection-glow, rgba(255, 214, 0, 0.9));
  pointer-events: none;
  box-sizing: border-box;
  background-color: var(--c64-selection-fill, rgba(255, 214, 0, 0.16));
  z-index: 9;
}

.screen-selection-marquee {
  position: absolute;
  border: 1px dashed #000000;
  outline: 2px dashed var(--c64-selection-outline, #ffd600);
  background: var(--c64-selection-fill, rgba(255, 214, 0, 0.28));
  box-shadow: 0 0 6px rgba(0, 0, 0, 0.9);
  pointer-events: none;
  box-sizing: border-box;
  z-index: 15;
}

.screen-selected-overlay {
  position: absolute;
  outline: 2px solid var(--c64-selection-outline, #ffd600);
  outline-offset: -1px;
  box-shadow: 0 0 0 1px #000000, inset 0 0 0 1px #000000,
    0 0 6px var(--c64-selection-glow, rgba(255, 214, 0, 0.8));
  pointer-events: none;
  box-sizing: border-box;
  background-color: var(--c64-selection-fill, rgba(255, 214, 0, 0.3));
  z-index: 8;
}

.screen-hover-overlay {
  position: absolute;
  outline: 2px solid #ffffff;
  outline-offset: -1px;
  box-shadow: 0 0 0 1px #000000, inset 0 0 0 1px #000000,
    0 0 6px rgba(255, 255, 255, 0.95);
  pointer-events: none;
  box-sizing: border-box;
  background-color: rgba(255, 255, 255, 0.25);
  z-index: 10;
}

.screen-canvas {
  width: 100%;
  height: auto;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
  display: block;
}

.charset-controls {
  padding: 4px;
  background: var(--c64-background);
}

.memory-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
  flex-wrap: wrap;
}

.memory-controls label {
  color: var(--c64-label);
  font-weight: bold;
  font-size: 13px;
}

.memory-controls input,
.memory-controls select,
.control-select {
  background: var(--c64-input-background);
  border: 1px solid var(--c64-input-border);
  color: var(--c64-input-foreground);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: var(--vscode-editor-font-family);
  font-size: 13px;
}

.memory-controls input:focus,
.memory-controls select:focus {
  outline: none;
  border-color: var(--c64-focus-border);
}

.color-input {
  width: 40px;
}

.hex-input {
  width: 60px;
}

.nav-btn {
  background: var(--c64-input-background);
  border: 1px solid var(--c64-input-border);
  color: var(--c64-input-foreground);
  padding: 1px 6px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s ease;
  min-width: 24px;
}

.nav-btn:hover {
  background: var(--c64-hover-background);
  border-color: var(--c64-focus-border);
}

.nav-btn:active {
  background: var(--c64-active-background);
}

.charset-grid-container {
  padding: 4px;
  background: var(--c64-background);
  border: 1px solid var(--c64-border);
  border-radius: 3px;
  overflow-x: auto;
}

.charset-grid {
  display: grid;
  grid-template-columns: repeat(16, min-content);
  gap: 2px;
  background: var(--c64-background);
  justify-content: start; /* align to the left inside the scroll area */
  position: relative;
  user-select: none;
}

.char-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 2px;
  border-radius: 3px;
  border: 1px solid transparent;
  cursor: pointer;
}

.char-cell.in-drag-rect {
  outline: 2px dashed var(--c64-selection-outline, #ffd600);
  outline-offset: -1px;
  box-shadow: 0 0 0 1px #000000;
  background: var(--c64-selection-fill, rgba(255, 214, 0, 0.28));
}

.char-cell.char-selected {
  background: var(--c64-selection-fill, rgba(255, 214, 0, 0.16));
  border-color: var(--c64-selection-outline, #ffd600);
  box-shadow: 0 0 0 1px #000000,
    0 0 6px var(--c64-selection-glow, rgba(255, 214, 0, 0.7));
}

.char-cell.char-selected .char-label {
  color: var(--c64-selection-outline, #ffd600);
  font-weight: bold;
  text-shadow: 0 1px 2px #000000;
}

.char-cell.char-selected .char-canvas {
  outline: 2px solid var(--c64-selection-outline, #ffd600);
  outline-offset: 1px;
  box-shadow: 0 0 0 1px #000000,
    0 0 6px var(--c64-selection-glow, rgba(255, 214, 0, 0.85));
}

.char-cell:hover,
.char-cell.highlight-from-screen {
  background: var(--c64-selection-fill, rgba(255, 214, 0, 0.22));
  border-color: var(--c64-selection-outline, #ffd600);
  box-shadow: 0 0 0 1px #000000,
    0 0 6px var(--c64-selection-glow, rgba(255, 214, 0, 0.75));
}

.char-cell.highlight-from-screen .char-label {
  color: var(--c64-selection-outline, #ffd600);
  font-weight: bold;
  text-shadow: 0 1px 2px #000000;
}

.char-cell:hover .char-canvas,
.char-cell.highlight-from-screen .char-canvas {
  outline: 2px solid var(--c64-selection-outline, #ffd600);
  outline-offset: 1px;
  box-shadow: 0 0 0 1px #000000,
    0 0 6px var(--c64-selection-glow, rgba(255, 214, 0, 0.9));
}

.char-label {
  font-size: 10px;
  color: var(--c64-label);
  margin-bottom: 2px;
  font-family: var(--vscode-editor-font-family);
}

.char-canvas {
  width: 24px;
  height: 24px;
  image-rendering: pixelated;
  border: 1px solid var(--c64-border);
  background-color: #000;
  cursor: context-menu;
}

.charset-context-menu {
  position: fixed;
  z-index: 1000;
  background: var(--vscode-menu-background, var(--c64-surface));
  border: 1px solid var(--vscode-menu-border, var(--c64-border));
  border-radius: 4px;
  box-shadow: 0 4px 16px var(--c64-shadow);
  padding: 4px;
}

.charset-context-menu-item {
  background: transparent;
  border: 0;
  color: var(--vscode-menu-foreground, var(--c64-foreground));
  padding: 6px 10px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
  width: 100%;
  text-align: left;
}

.charset-context-menu-item:hover {
  background: var(
    --vscode-menu-selectionBackground,
    var(--c64-active-background)
  );
  color: var(--vscode-menu-selectionForeground, var(--c64-foreground));
}

.flex-grow-tile {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 200px;
}

/* Force flex behavior inside the CollapsibleTile for this specific tile */
.flex-grow-tile > *:last-child {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.screenshot-viewer {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 8px;
  padding: 4px;
  height: 100%;
}

.screenshot-container {
  border: 1px solid var(--c64-border);
  border-radius: 3px;
  background: #000;
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 4px;
  overflow: hidden;
}

.screenshot-img {
  image-rendering: pixelated;
  image-rendering: crisp-edges;
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
</style>
