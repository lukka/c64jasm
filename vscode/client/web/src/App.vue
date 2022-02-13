<template>
  <!-- <img alt="Vue logo" src="${baseUri}/assets/logo.png" />-->
  <C64Registers />
</template>

<script lang="ts">
//??import { defineComponent } from "vue";
import C64Registers from "./components/C64Registers.vue";

export default {
  name: "App",
  components: {
    C64Registers,
  },
};
</script>

<style>
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
