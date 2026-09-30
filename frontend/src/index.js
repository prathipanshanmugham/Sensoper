import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";

// Benign browser notice (Radix dialogs + layout shifts) that the CRA dev overlay otherwise treats as a runtime error.
window.addEventListener("error", (e) => {
  if (typeof e.message === "string" && e.message.includes("ResizeObserver loop")) e.stopImmediatePropagation();
});

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
