import express from 'express';
import bodyParser from 'body-parser';
import axios from 'axios';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// ES module path resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { Pool } = pg;

const app = express();
const port = process.env.PORT || 3000;
const API_URL = process.env.TMDB_API_URL || 'https://api.themoviedb.org/3/';
const API_KEY = process.env.TMDB_API_KEY || 'your_tmdb_api_key';
const imageBaseURL = 'https://image.tmdb.org/t/p/';

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Setup PostgreSQL connection
const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: {
        rejectUnauthorized: false, // Adjust based on your database settings
    },
});

// Handle errors with the pool
pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
});

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Function to fetch genres from API
async function fetchGenre() {
    try {
        console.log('Fetching genres...');
        const result = await axios.get(`${API_URL}genre/movie/list?api_key=${API_KEY}`);
        console.log('Genres fetched successfully.');
        return result.data.genres.map((genre) => ({
            id: genre.id,
            name: genre.name,
        }));
    } catch (err) {
        console.error('Error fetching genres:', err.response ? err.response.data : err.message);
        if (err.response) {
            console.error('Status Code:', err.response.status);
            console.error('Headers:', err.response.headers);
        }
        return [];
    }
}

// Function to fetch a random movie poster for a given genre
async function fetchGenreImage(genreId) {
    try {
        const genreInfo = await axios.get(`${API_URL}discover/movie?include_adult=true&include_video=true&api_key=${API_KEY}&page=1&sort_by=popularity.desc&with_genres=${genreId}&language=en-US`);
        const randomMovie = genreInfo.data.results[Math.floor(Math.random() * genreInfo.data.results.length)];
        console.log(`Fetched image for genre ${genreId}`);
        return randomMovie?.poster_path || null;
    } catch (err) {
        console.error('Error fetching genre image:', err.response?.data || err.message);
        return null;
    }
}

// Rendering main page
app.get('/', async (req, res) => {
    try {
        const genres = await fetchGenre();
        const genreImages = await Promise.all(genres.map((genre) => fetchGenreImage(genre.id)));
        res.render('main.ejs', { genres, genreImages });
    } catch (error) {
        console.error('Error rendering main page:', error);
        res.status(500).send(`Error fetching genres: ${error.message}`);
    }
});

// Handling search request
app.get('/search', async (req, res) => {
    const movieName = req.query.movieName;
    console.log(`Searching for movie: ${movieName}`);

    try {
        const searchResult = await axios.get(`${API_URL}search/movie?query=${encodeURIComponent(movieName)}&api_key=${API_KEY}`);
        if (searchResult.data.results.length > 0) {
            const { id: movieId, title: movieTitle } = searchResult.data.results[0];
            console.log(`Found movie: ${movieTitle} (${movieId})`);
            res.redirect(`/review/${movieId}/${encodeURIComponent(movieTitle)}`);
        } else {
            console.log(`No results found for movie: ${movieName}`);
            res.redirect('/');
        }
    } catch (error) {
        console.error('Error searching for movie:', error.response?.data || error.message);
        res.status(500).send('Error searching for movie');
    }
});

// Rendering genre page
app.get('/genre/:genreId/:genreName', async (req, res) => {
    try {
        const { genreId: id, genreName: name } = req.params;
        console.log(`Fetching movies for genre: ${name} (${id})`);
        const result = await axios.get(`${API_URL}discover/movie?include_adult=true&include_video=true&api_key=${API_KEY}&page=1&sort_by=popularity.desc&with_genres=${id}&language=en-US`);
        const movies = result.data.results;

        console.log(`Rendering genre page: ${name}`);
        res.render('list.ejs', { title: name, movies });
    } catch (error) {
        console.error('Error fetching movies by genre:', error.response?.data || error.message);
        res.status(500).send('Error fetching movies by genre');
    }
});

// Rendering review page for a specific movie
app.get('/review/:movieId/:movieTitle', async (req, res) => {
    const { movieId } = req.params;
    console.log(`Fetching details and reviews for movie: ${movieId}`);

    try {
        const movieResult = await axios.get(`${API_URL}movie/${movieId}?language=en-US&api_key=${API_KEY}`);
        const reviewsResult = await pool.query('SELECT * FROM review WHERE movie_id = $1 ORDER BY id ASC;', [movieId]);
        console.log('Rendering review page...');
        res.render('review.ejs', { movie: movieResult.data, review: reviewsResult.rows });
    } catch (error) {
        console.error('Error fetching movie and reviews:', error.response?.data || error.message);
        res.status(500).send('Error fetching movie and reviews');
    }
});

// Render the review creation page with movieId
app.get('/review/:movieId/:movieTitle/new', async (req, res) => {
    const { movieId, movieTitle } = req.params;
    const sanitizedTitle = movieTitle.replace(/[^a-zA-Z0-9 ]/g, '');
    console.log(`Rendering new review page for movie: ${movieId} (${sanitizedTitle})`);

    try {
        const movieResult = await axios.get(`${API_URL}movie/${movieId}?language=en-US&api_key=${API_KEY}`);
        res.render('new.ejs', { movie: movieResult.data, movieId, movieTitle: sanitizedTitle, heading: 'New Review', submit: 'Create Review' });
    } catch (error) {
        console.error('Error fetching movie details for review creation:', error.response?.data || error.message);
        res.status(500).send('Error fetching movie details for review creation');
    }
});

// Add review
app.post('/review/:movieId/:movieTitle/add', async (req, res) => {
    const { name, score, content } = req.body;
    const { movieId, movieTitle } = req.params;

    console.log(`Adding review for movie: ${movieId}`);
    try {
        await pool.query('INSERT INTO review (name, score, content, movie_id) VALUES ($1, $2, $3, $4);', [name, score, content, movieId]);
        res.redirect(`/review/${movieId}/${movieTitle}`);
    } catch (err) {
        console.error('Error adding review:', err.message);
        res.status(500).send('Error adding review');
    }
});

// Render the review edit page with movieId
app.get('/review/:movieId/:movieTitle/edit/:reviewId', async (req, res) => {
    const { movieId, movieTitle, reviewId } = req.params;
    const sanitizedTitle = movieTitle.replace(/[^a-zA-Z0-9 ]/g, '');
    console.log(`Rendering edit review page for movie: ${movieId} (${sanitizedTitle}), review ID: ${reviewId}`);

    try {
        const movieResult = await axios.get(`${API_URL}movie/${movieId}?language=en-US&api_key=${API_KEY}`);
        const reviewResult = await pool.query('SELECT * FROM review WHERE id = $1 AND movie_id = $2;', [reviewId, movieId]);
        res.render('new.ejs', { movie: movieResult.data, review: reviewResult.rows[0], movieId, movieTitle: sanitizedTitle, heading: 'Edit Review', submit: 'Update Review' });
    } catch (err) {
        console.error('Error fetching movie and review details for editing:', err.message);
        res.status(500).send('Error fetching movie and review details for editing');
    }
});

// Edit review
app.post('/review/:movieId/:movieTitle/update', async (req, res) => {
    const { score, content, editReviewId: reviewId } = req.body;
    const { movieId, movieTitle } = req.params;

    console.log(`Updating review for movie: ${movieId}, review ID: ${reviewId}`);
    try {
        await pool.query('UPDATE review SET score = $1, content = $2 WHERE id = $3 AND movie_id = $4;', [score, content, reviewId, movieId]);
        res.redirect(`/review/${movieId}/${movieTitle}`);
    } catch (err) {
        console.error('Error updating review:', err.message);
        res.status(500).send('Error updating review');
    }
});

// Delete review
app.post('/review/:movieId/:movieTitle/delete/:reviewId', async (req, res) => {
    const { movieId, movieTitle, reviewId } = req.params;

    console.log(`Deleting review for movie: ${movieId}, review ID: ${reviewId}`);
    try {
        await pool.query('DELETE FROM review WHERE id = $1 AND movie_id = $2;', [reviewId, movieId]);
        res.redirect(`/review/${movieId}/${movieTitle}`);
    } catch (err) {
        console.error('Error deleting review:', err.message);
        res.status(500).send('Error deleting review');
    }
});

// Start server
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
