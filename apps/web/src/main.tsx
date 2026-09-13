import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./styles/design-system.css";
import "./styles/antd-adapter.css";
import "./styles/inpulse-design.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root container #root is missing");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
