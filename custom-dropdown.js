// Custom Dropdown Component
document.addEventListener('DOMContentLoaded', () => {
    initCustomDropdowns();
});

function initCustomDropdowns() {
    // Find all select elements with the preset-select class
    const selectElements = document.querySelectorAll('select.preset-select');
    
    selectElements.forEach(select => {
        createCustomDropdown(select);
    });
    
    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        const dropdowns = document.querySelectorAll('.custom-dropdown');
        dropdowns.forEach(dropdown => {
            if (!dropdown.contains(e.target)) {
                dropdown.classList.remove('open');
            }
        });
    });
}

function createCustomDropdown(selectElement) {
    // Create container
    const dropdownContainer = document.createElement('div');
    dropdownContainer.className = 'custom-dropdown';
    
    // Store the original select element's ID and onchange function
    const selectId = selectElement.id;
    const onchangeFunction = selectElement.getAttribute('onchange');
    
    // Create selected display
    const selectedDisplay = document.createElement('div');
    selectedDisplay.className = 'custom-dropdown-selected';
    selectedDisplay.tabIndex = 0; // Make it focusable
    
    // Add text and icon
    const selectedText = document.createElement('span');
    // Use a shorter display text for better UI
    let displayText = selectElement.options[selectElement.selectedIndex]?.text || '';
    // If it's the default empty option or 'Presets', show 'Presets'
    if (!displayText || displayText === 'Presets') {
        displayText = 'Presets';
    }
    // If the text is too long, truncate it
    else if (displayText.length > 15) {
        // For gas price options with 'gwei', keep the important parts
        if (displayText.includes('gwei')) {
            const gweiValue = displayText.split(' ')[0];
            displayText = `${gweiValue} gwei`;
        } else {
            displayText = displayText.substring(0, 12) + '...';
        }
    }
    selectedText.textContent = displayText;
    
    const icon = document.createElement('i');
    icon.className = 'fas fa-chevron-down';
    icon.style.fontSize = '0.8rem';
    icon.style.marginLeft = '4px';
    
    selectedDisplay.appendChild(selectedText);
    selectedDisplay.appendChild(icon);
    
    // Create options container
    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'custom-dropdown-options';
    
    // Create options
    const options = Array.from(selectElement.options);
    
    // Filter out any option with text 'Presets'
    const filteredOptions = options.filter(option => option.text !== 'Presets');
    
    filteredOptions.forEach(option => {
        const optionElement = document.createElement('div');
        optionElement.className = 'custom-dropdown-option';
        if (option.selected) {
            optionElement.classList.add('selected');
        }
        optionElement.textContent = option.text;
        optionElement.dataset.value = option.value;
        
        optionElement.addEventListener('click', () => {
            // Update selected text with truncation for better UI
            let displayText = option.text;
            // If it's the default empty option or 'Presets', show 'Presets'
            if (!displayText || displayText === 'Presets') {
                displayText = 'Presets';
            }
            // If the text is too long, truncate it
            else if (displayText.length > 15) {
                // For gas price options with 'gwei', keep the important parts
                if (displayText.includes('gwei')) {
                    const gweiValue = displayText.split(' ')[0];
                    displayText = `${gweiValue} gwei`;
                } else {
                    displayText = displayText.substring(0, 12) + '...';
                }
            }
            selectedText.textContent = displayText;
            
            // Update all options (remove selected class)
            optionsContainer.querySelectorAll('.custom-dropdown-option').forEach(opt => {
                opt.classList.remove('selected');
            });
            
            // Add selected class to clicked option
            optionElement.classList.add('selected');
            
            // Update the original select element
            selectElement.value = option.value;
            
            // Close dropdown
            dropdownContainer.classList.remove('open');
            
            // Trigger the original onchange event
            if (onchangeFunction) {
                eval(onchangeFunction);
            }
            
            // Dispatch change event
            const event = new Event('change');
            selectElement.dispatchEvent(event);
        });
        
        optionsContainer.appendChild(optionElement);
    });
    
    // Toggle dropdown
    selectedDisplay.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdownContainer.classList.toggle('open');
        if (dropdownContainer.classList.contains('open')) {
            selectedDisplay.setAttribute('aria-expanded', 'true');
        } else {
            selectedDisplay.setAttribute('aria-expanded', 'false');
        }
    });
    
    // Handle keyboard navigation
    selectedDisplay.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            dropdownContainer.classList.toggle('open');
        } else if (e.key === 'Escape') {
            dropdownContainer.classList.remove('open');
        } else if (e.key === 'ArrowDown' && dropdownContainer.classList.contains('open')) {
            e.preventDefault();
            const firstOption = optionsContainer.querySelector('.custom-dropdown-option');
            if (firstOption) firstOption.focus();
        }
    });
    
    // Add components to container
    dropdownContainer.appendChild(selectedDisplay);
    dropdownContainer.appendChild(optionsContainer);
    
    // Replace the original select with our custom dropdown
    selectElement.style.display = 'none';
    selectElement.parentNode.insertBefore(dropdownContainer, selectElement.nextSibling);
    
    // Store reference to the original select for value retrieval
    dropdownContainer.dataset.for = selectId;
    
    return dropdownContainer;
}

// Function to get the value from a custom dropdown
function getCustomDropdownValue(dropdownId) {
    const originalSelect = document.getElementById(dropdownId);
    return originalSelect ? originalSelect.value : '';
}

// Function to set the value of a custom dropdown
function setCustomDropdownValue(dropdownId, value) {
    const originalSelect = document.getElementById(dropdownId);
    if (!originalSelect) return;
    
    originalSelect.value = value;
    
    // Update the custom dropdown display
    const customDropdown = document.querySelector(`.custom-dropdown[data-for="${dropdownId}"]`);
    if (!customDropdown) return;
    
    const selectedText = customDropdown.querySelector('.custom-dropdown-selected span');
    const options = originalSelect.options;
    
    for (let i = 0; i < options.length; i++) {
        if (options[i].value === value) {
            // Apply the same text truncation logic for consistency
            let displayText = options[i].text;
            // If it's the default empty option or 'Presets', show 'Presets'
            if (!displayText || displayText === 'Presets') {
                displayText = 'Presets';
            }
            // If the text is too long, truncate it
            else if (displayText.length > 15) {
                // For gas price options with 'gwei', keep the important parts
                if (displayText.includes('gwei')) {
                    const gweiValue = displayText.split(' ')[0];
                    displayText = `${gweiValue} gwei`;
                } else {
                    displayText = displayText.substring(0, 12) + '...';
                }
            }
            selectedText.textContent = displayText;
            break;
        }
    }
    
    // Update selected class on options
    const optionElements = customDropdown.querySelectorAll('.custom-dropdown-option');
    optionElements.forEach(opt => {
        opt.classList.remove('selected');
        if (opt.dataset.value === value) {
            opt.classList.add('selected');
        }
    });
}

// Make functions available globally
window.getCustomDropdownValue = getCustomDropdownValue;
window.setCustomDropdownValue = setCustomDropdownValue;

// Function to refresh a custom dropdown after updating the original select's options
function refreshCustomDropdown(selectId) {
    const selectElement = document.getElementById(selectId);
    if (!selectElement) return;
    
    // Find and remove the existing custom dropdown
    const existingCustomDropdown = document.querySelector(`.custom-dropdown[data-for="${selectId}"]`);
    if (existingCustomDropdown) {
        existingCustomDropdown.remove();
    }
    
    // Recreate the custom dropdown
    createCustomDropdown(selectElement);
}

window.refreshCustomDropdown = refreshCustomDropdown;
window.initCustomDropdowns = initCustomDropdowns;
window.createCustomDropdown = createCustomDropdown;
