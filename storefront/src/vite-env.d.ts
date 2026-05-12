/// <reference types="vite/client" />

interface CE408Config {
  apiBase: string;
}

interface Window {
  __CE408_CONFIG__?: CE408Config;
}
