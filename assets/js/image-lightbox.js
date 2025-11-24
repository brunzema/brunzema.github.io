/**
 * Lightbox Modal Handler
 * Finds all links with the class '.js-lightbox' and uses their href (the full image path)
 * to display a large, centered image modal.
 */
document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('imageModal');
    const modalImage = document.getElementById('modalImage');

    if (!modal) return; // Exit if modal structure is missing

    // 1. Attach click listener to all image links
    document.querySelectorAll('.js-lightbox').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault(); // Prevent default link behavior (navigating away)
            
            const imageUrl = link.getAttribute('href');
            
            // Check if it's a valid link and an image source is available
            if (imageUrl) {
                modalImage.src = imageUrl;
                modal.classList.add('active');
                document.body.style.overflow = 'hidden'; // Prevent background scrolling
            }
        });
    });

    // 2. Attach click listener to close the modal
    modal.addEventListener('click', (e) => {
        // Only close if clicking the backdrop, not the image itself
        if (e.target === modal) {
            modal.classList.remove('active');
            modalImage.src = ''; // Clear the image source
            document.body.style.overflow = 'auto'; // Restore background scrolling
        }
    });

    // 3. Attach keyboard listener (Escape key) to close the modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('active')) {
            modal.classList.remove('active');
            modalImage.src = '';
            document.body.style.overflow = 'auto';
        }
    });
});