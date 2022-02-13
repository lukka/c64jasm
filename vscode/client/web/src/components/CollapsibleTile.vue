<template>
  <div class="collapsible-tile">
    <div class="tile-header" @click="toggle">
      <span class="tile-icon">{{ isCollapsed ? "▶" : "▼" }}</span>
      <h3 class="tile-title">{{ title }}</h3>
    </div>
    <div v-show="!isCollapsed" class="tile-content">
      <slot></slot>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";

export default defineComponent({
  name: "CollapsibleTile",
  props: {
    title: {
      type: String,
      required: true,
    },
    initiallyCollapsed: {
      type: Boolean,
      default: false,
    },
  },
  setup(props) {
    const isCollapsed = ref(props.initiallyCollapsed);

    const toggle = () => {
      isCollapsed.value = !isCollapsed.value;
    };

    return {
      isCollapsed,
      toggle,
    };
  },
});
</script>

<style scoped>
.collapsible-tile {
  background: #2d2d30;
  border-radius: 4px;
  margin-bottom: 2px;
  overflow: hidden;
}

.tile-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px;
  background: #252526;
  cursor: pointer;
  user-select: none;
  transition: background 0.2s ease;
}

.tile-header:hover {
  background: #2a2d2e;
}

.tile-icon {
  color: #4ec9b0;
  font-size: 10px;
  width: 12px;
  display: inline-block;
}

.tile-title {
  color: #4ec9b0;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  flex: 1;
}

.tile-content {
  padding: 4px;
}
</style>
