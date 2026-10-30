import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/App";
import { site } from "@/data/site";
import "@/styles.css";

document.title = site.title;
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
