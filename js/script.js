const lobbyTitle = document.getElementById("editor");
const displayName = document.getElementById("display-name");
const copyButton = document.getElementById("copy-button");
const maxLength = 35;
const displayView = document.getElementById("display-view");

lobbyTitle.addEventListener("input", () => {
    if (lobbyTitle.value.trim() === "") {
        displayView.classList.remove("visible-display-view");
    } else {
        displayView.classList.add("visible-display-view");
    }
    const inputText = lobbyTitle.value;
    displayName.textContent = inputText;
});



copyButton.addEventListener("click", () => {
    const textToCopy = displayName.textContent;
    if (textToCopy) {
        navigator.clipboard.writeText(textToCopy)
            .then(() => {
                alert("Copied to clipboard: " + textToCopy);
            })
            .catch(err => {
                console.error("Failed to copy text: ", err);
            });
    } else {
        alert("Nothing to copy!");
    }
});


