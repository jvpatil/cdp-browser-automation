document.querySelectorAll(".sheet-head .back").forEach((button) => {
  button.textContent = "Save & Return";
  button.setAttribute("aria-label", "Save configuration and return");
});
