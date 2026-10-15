import React from "react";
import ReactDOM from "react-dom/client";
import { CoreOnlyApp } from "./app/CoreOnlyApp.tsx";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode><CoreOnlyApp /></React.StrictMode>,
);
