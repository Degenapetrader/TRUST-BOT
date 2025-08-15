// Sidebar Toggle Functionality
document.addEventListener('DOMContentLoaded', function() {
    const toggleLeftBtn = document.getElementById('toggle-left-sidebar');
    const mainContent = document.querySelector('.main-content');
    const sidebar = document.querySelector('.sidebar');
    
    // Function to handle system status visibility when collapsed
    function handleSystemStatus(isCollapsed) {
        const systemStatusSection = document.querySelector('.system-status-section');
        if (!systemStatusSection) return;
        
        if (isCollapsed) {
            // Hide system status completely
            systemStatusSection.style.display = 'none';
        } else {
            // Show system status
            systemStatusSection.style.display = '';
        }
    }
    
    // Always start with uncollapsed sidebar regardless of saved state
    localStorage.setItem('leftSidebarCollapsed', 'false');
    mainContent.classList.remove('left-collapsed');
    toggleLeftBtn.innerHTML = '<<';
    handleSystemStatus(false);
    
    // Toggle left sidebar
    toggleLeftBtn.addEventListener('click', function() {
        const isCollapsed = mainContent.classList.toggle('left-collapsed');
        
        // Update chevron based on state
        if (isCollapsed) {
            toggleLeftBtn.innerHTML = '>>';
        } else {
            toggleLeftBtn.innerHTML = '<<';
        }
        
        // Handle system status visibility
        handleSystemStatus(isCollapsed);
        
        // Save state to localStorage
        localStorage.setItem('leftSidebarCollapsed', isCollapsed);
        
        // Fix transaction panel resize issue when reopening sidebar
        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
        }, 300); // Wait for CSS transition to complete
    });
});
