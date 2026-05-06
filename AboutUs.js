document.addEventListener('DOMContentLoaded', () => {
    // 1. FADE-IN ON SCROLL
    const faders = document.querySelectorAll('.fade');
    const appearOptions = { threshold: 0.15 };

    const appearOnScroll = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('show');
                observer.unobserve(entry.target);
            }
        });
    }, appearOptions);

    faders.forEach(fader => appearOnScroll.observe(fader));

    // 2. IMAGE ENLARGE (MODAL) FEATURE
    const modal = document.getElementById("imageModal");
    const modalImg = document.getElementById("fullImage");
    const closeBtn = document.querySelector(".close-modal");
    const triggers = document.querySelectorAll(".enlarge-trigger");

    triggers.forEach(img => {
        img.onclick = function() {
            modal.style.display = "flex";
            modal.style.alignItems = "center";
            modalImg.src = this.src;
        }
    });

    // Close modal when clicking 'X' or outside the image
    closeBtn.onclick = () => modal.style.display = "none";
    window.onclick = (event) => {
        if (event.target == modal) modal.style.display = "none";
    }

    // 3. Hamburger menu toggle
    const hamburger = document.getElementById('hamburger-menu');
    const navLinks = document.getElementById('nav-links');
    if (hamburger && navLinks) {
        hamburger.addEventListener('click', () => {
            hamburger.classList.toggle('active');
            navLinks.classList.toggle('open');
        });
        // Optional: close menu when a link is clicked (mobile UX)
        navLinks.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                hamburger.classList.remove('active');
                navLinks.classList.remove('open');
            });
        });
    }
});

// Add this to your script.js or at the bottom of your HTML
document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById("imageModal");
    const modalImg = document.getElementById("fullImage");
    const closeBtn = document.querySelector(".close-modal");
    
    // We target the 'member' card itself so it doesn't matter if you click the image or the name
    const memberCards = document.querySelectorAll(".member");

    memberCards.forEach(card => {
        card.addEventListener('click', () => {
            const img = card.querySelector('img'); // Find the image inside this card
            if (img) {
                modal.style.display = "flex";
                modalImg.src = img.src;
            }
        });
    });

    // Close logic
    closeBtn.onclick = () => modal.style.display = "none";
    window.onclick = (e) => { if (e.target == modal) modal.style.display = "none"; };
});