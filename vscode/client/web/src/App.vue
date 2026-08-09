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
:root,
body.vscode-dark,
body.vscode-high-contrast {
  color-scheme: dark;
  --c64-background: var(--vscode-editor-background, #1e1e1e);
  --c64-foreground: var(--vscode-editor-foreground, #d4d4d4);
  --c64-surface: var(--vscode-sideBar-background, #252526);
  --c64-surface-raised: var(--vscode-editorWidget-background, #2d2d30);
  --c64-hover-background: var(--vscode-list-hoverBackground, #2a2d2e);
  --c64-active-background: var(
    --vscode-list-activeSelectionBackground,
    #37373d
  );
  --c64-border: var(--vscode-widget-border, #3e3e42);
  --c64-focus-border: var(--vscode-focusBorder, #4ec9b0);
  --c64-accent: var(--vscode-textLink-foreground, #4ec9b0);
  --c64-label: var(--vscode-symbolIcon-variableForeground, #569cd6);
  --c64-value: var(--vscode-debugTokenExpression-value, #b5cea8);
  --c64-detail: var(--vscode-symbolIcon-stringForeground, #ce9178);
  --c64-muted: var(--vscode-descriptionForeground, #6a6a6a);
  --c64-input-background: var(--vscode-input-background, #2d2d30);
  --c64-input-foreground: var(--vscode-input-foreground, #d4d4d4);
  --c64-input-border: var(--vscode-input-border, var(--c64-border));
  --c64-secondary-button-background: var(
    --vscode-button-secondaryBackground,
    #203a2b
  );
  --c64-secondary-button-foreground: var(
    --vscode-button-secondaryForeground,
    #d7f5df
  );
  --c64-secondary-button-hover: var(
    --vscode-button-secondaryHoverBackground,
    #2a4a2a
  );
  --c64-selection-background: var(--vscode-editor-selectionBackground, #264f78);
  --c64-selection-foreground: var(--vscode-editor-selectionForeground, #ffffff);
  --c64-success-background: var(
    --vscode-diffEditor-insertedTextBackground,
    #334d33
  );
  --c64-success-foreground: var(--vscode-testing-iconPassed, #90ee90);
  --c64-match-background: var(--vscode-editor-findMatchBackground, #4d334d);
  --c64-match-border: var(--vscode-editor-findMatchBorder, #f94c4c);
  --c64-match-foreground: var(--vscode-editor-foreground, #ffb3ff);
  --c64-combined-background: var(
    --vscode-editor-findMatchHighlightBackground,
    #5a4d3a
  );
  --c64-combined-border: var(--vscode-editorWarning-foreground, #ffd700);
  --c64-combined-foreground: var(--vscode-editor-foreground, #ffffaa);
  --c64-shadow: var(--vscode-widget-shadow, rgba(0, 0, 0, 0.35));
  --c64-warning-background: var(
    --vscode-inputValidation-warningBackground,
    #4d3a00
  );
  --c64-warning-foreground: var(
    --vscode-inputValidation-warningForeground,
    #f2e9c7
  );
  --c64-warning-border: var(--vscode-inputValidation-warningBorder, #cca700);
}

body.vscode-light,
body.vscode-high-contrast-light {
  color-scheme: light;
  --c64-background: var(--vscode-editor-background, #ffffff);
  --c64-foreground: var(--vscode-editor-foreground, #333333);
  --c64-surface: var(--vscode-sideBar-background, #f3f3f3);
  --c64-surface-raised: var(--vscode-editorWidget-background, #f8f8f8);
  --c64-hover-background: var(--vscode-list-hoverBackground, #e8e8e8);
  --c64-active-background: var(
    --vscode-list-activeSelectionBackground,
    #e0e0e0
  );
  --c64-border: var(--vscode-widget-border, #c8c8c8);
  --c64-focus-border: var(--vscode-focusBorder, #007acc);
  --c64-accent: var(--vscode-textLink-foreground, #006ab1);
  --c64-label: var(--vscode-symbolIcon-variableForeground, #0451a5);
  --c64-value: var(--vscode-debugTokenExpression-value, #098658);
  --c64-detail: var(--vscode-symbolIcon-stringForeground, #a31515);
  --c64-muted: var(--vscode-descriptionForeground, #767676);
  --c64-input-background: var(--vscode-input-background, #ffffff);
  --c64-input-foreground: var(--vscode-input-foreground, #333333);
  --c64-input-border: var(--vscode-input-border, var(--c64-border));
  --c64-secondary-button-background: var(
    --vscode-button-secondaryBackground,
    #e5e5e5
  );
  --c64-secondary-button-foreground: var(
    --vscode-button-secondaryForeground,
    #333333
  );
  --c64-secondary-button-hover: var(
    --vscode-button-secondaryHoverBackground,
    #d7d7d7
  );
  --c64-selection-background: var(--vscode-editor-selectionBackground, #add6ff);
  --c64-selection-foreground: var(--vscode-editor-selectionForeground, #000000);
  --c64-success-background: var(
    --vscode-diffEditor-insertedTextBackground,
    #d9f2dd
  );
  --c64-success-foreground: var(--vscode-testing-iconPassed, #16825d);
  --c64-match-background: var(--vscode-editor-findMatchBackground, #f6d6ef);
  --c64-match-border: var(--vscode-editor-findMatchBorder, #c72e6c);
  --c64-match-foreground: var(--vscode-editor-foreground, #7a1746);
  --c64-combined-background: var(
    --vscode-editor-findMatchHighlightBackground,
    #fff2cc
  );
  --c64-combined-border: var(--vscode-editorWarning-foreground, #9d7400);
  --c64-combined-foreground: var(--vscode-editor-foreground, #5f4700);
  --c64-shadow: var(--vscode-widget-shadow, rgba(0, 0, 0, 0.18));
  --c64-warning-background: var(
    --vscode-inputValidation-warningBackground,
    #fff4ce
  );
  --c64-warning-foreground: var(
    --vscode-inputValidation-warningForeground,
    #5f4700
  );
  --c64-warning-border: var(--vscode-inputValidation-warningBorder, #cca700);
}

body {
  margin: 0;
  background: var(--c64-background);
  color: var(--c64-foreground);
}

.warning-banner {
  background-color: var(--c64-warning-background);
  color: var(--c64-warning-foreground);
  border: 1px solid var(--c64-warning-border);
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
  min-height: 100vh;
  box-sizing: border-box;
  background: var(--c64-background);
  color: var(--c64-foreground);
  font-family: var(--vscode-font-family, Avenir, Helvetica, Arial, sans-serif);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: left;
  margin-top: 0px;
  padding: 4px;
}
</style>
