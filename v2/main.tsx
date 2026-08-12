import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";
import AuthBoundary from "./AuthBoundary";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthBoundary><App /></AuthBoundary>
  </StrictMode>,
);
