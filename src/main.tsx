import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "@fontsource-variable/inter"; // bundled locally — no font CDN, nothing leaves the device
import "@fontsource-variable/fraunces"; // display face for headlines & the net-worth figure
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
