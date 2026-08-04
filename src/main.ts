import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./styles.css";

/*
 * Canvas never downloads a webfont. It resolves `ctx.font` against faces the
 * document has already loaded and quietly falls back to a system face for
 * anything else — no error, just the wrong letterforms.
 *
 * Every other weight the app uses is on a DOM element somewhere, so the
 * document pulls it in on its own. Geist Mono Bold is the exception: it is
 * used only for the letter inside a piano note, which is drawn, never marked
 * up. So ask for it here.
 */
void document.fonts?.load('700 17px "Geist Mono"');

createApp(App).use(createPinia()).mount("#app");
