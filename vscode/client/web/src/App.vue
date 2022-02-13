<template>
  <!-- <img alt="Vue logo" src="${baseUri}/assets/logo.png" />-->
  <div v-if="!isPaused" class="warning-banner">
    ⚠️ Data is NOT up-to-date: Emulator is running. Pause execution to update.
  </div>
  <C64Registers />
</template>

<script lang="ts">
//??import { defineComponent } from "vue";
import { mapGetters } from "vuex";
import C64Registers from "./components/C64Registers.vue";

export default {
  name: "App",
  components: {
    C64Registers,
  },
  computed: {
    ...mapGetters(["isPaused"]),
  },
};
</script>

<style>
.warning-banner {
  background-color: var(--vscode-editorWarning-background, #4d3a00);
  color: var(--vscode-editorWarning-foreground, #cca700);
  border: 1px solid var(--vscode-editorWarning-border, #cca700);
  padding: 8px 12px;
  margin-bottom: 12px;
  border-radius: 4px;
  font-weight: 600;
  text-align: center;
  position: sticky;
  top: 0;
  z-index: 100;
}

#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: left;
  color: #2c3e50;
  margin-top: 0px;
  padding: 4px;
}
</style>
