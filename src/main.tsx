import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./index.css";
import App from "./App";
import WidgetApp from "./widget/WidgetApp";

const isWidget = getCurrentWindow().label === "widget";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isWidget ? <WidgetApp /> : <App />}</React.StrictMode>,
);