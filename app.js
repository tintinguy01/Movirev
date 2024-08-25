import express from "express";
import bodyParser from "body-parser";
import axios from 'axios';
import pg from 'pg';

const { Pool } = pg;

const app = express();
const port = process.env.PORT || 3000;
const API_URL = "https://api.themoviedb.org/3/";
const API_KEY = "b8f254b4109691ac760b8537a6b443fe";
const imageBaseURL = 'https://image.tmdb.org/t/p/';

const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: {
        rejectUnauthorized: false,
    }
});

// Handle errors with the pool
pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
});

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

// Function to fetch genres from API
async function fetchGenre() {
    try {
        const result = await axios.get(`${API_URL}genre/movie/list?api_key=${API_KEY}`);
        return result.data.genres.map(genre => ({
            id: genre.id,
            name: genre.name
        }));
    } catch (err) {
        console.error("Error fetching genres:", err);
        return [];
    }
}

// Function to fetch a random movie poster for a given genre
async function fetchGenreImage(genreId) {
    try {
        const genreInfo = await axios.get(`${API_URL}discover/movie?include_adult=true&include_video=true&api_key=${API_KEY}&page=1&sort_by=popularity.desc&with_genres=${genreId}&language=en-US`);
        const randomMovie = genreInfo.data.results[Math.floor(Math.random() * genreInfo.data.results.length)];
        return randomMovie.poster_path;
    } catch (err) {
        console.error("Error fetching genre image:", err);
        return null;
    }
}

// Rendering main page
app.get("/", async (req, res) => {
    try {
        const genres = await fetchGenre();

        // Fetch genre images for all genres asynchronously
        const genreImages = await Promise.all(genres.map(genre => fetchGenreImage(genre.id)));

        res.render("main.ejs", { genres, genreImages });
    } catch (error) {
        console.error("Error rendering main page:", error);
        res.status(500).send("Error fetching genres");
    }
});

// Handling search request
app.get("/search", async (req, res) => {
    const movieName = req.query.movieName;

    try {
        const searchResult = await axios.get(`${API_URL}search/movie?query=${encodeURIComponent(movieName)}&api_key=${API_KEY}`);
        if (searchResult.data.results.length > 0) {
            const { id: movieId, title: movieTitle } = searchResult.data.results[0];
            res.redirect(`/review/${movieId}/${encodeURIComponent(movieTitle)}`);
        } else {
            res.redirect("/");
        }
    } catch (error) {
        console.error("Error searching for movie:", error);
        res.status(500).send("Error searching for movie");
    }
});

// Rendering genre page
app.get("/genre/:genreId/:genreName", async (req, res) => {
    try {
        const { genreId: id, genreName: name } = req.params;
        const result = await axios.get(`${API_URL}discover/movie?include_adult=true&include_video=true&api_key=${API_KEY}&page=1&sort_by=popularity.desc&with_genres=${id}&language=en-US`);
        const movies = result.data.results;

        res.render("list.ejs", { title: name, movies });
    } catch (error) {
        console.error("Error fetching movies by genre:", error);
        res.status(500).send("Error fetching movies by genre");
    }
});

// Rendering review page for a specific movie
app.get("/review/:movieId/:movieTitle", async (req, res) => {
    const { movieId } = req.params;

    try {
        const movieResult = await axios.get(`${API_URL}movie/${movieId}?language=en-US&api_key=${API_KEY}`);
        const reviewsResult = await pool.query("SELECT * FROM review WHERE movie_id = $1 ORDER BY id ASC;", [movieId]);
        res.render("review.ejs", { movie: movieResult.data, review: reviewsResult.rows });
    } catch (error) {
        console.error("Error fetching movie and reviews:", error);
        res.status(500).send("Error fetching movie and reviews");
    }
});

// Render the review creation page with movieId
app.get("/review/:movieId/:movieTitle/new", async (req, res) => {
    const { movieId, movieTitle } = req.params;
    const sanitizedTitle = movieTitle.replace(/[^a-zA-Z0-9 ]/g, "");

    try {
        const movieResult = await axios.get(`${API_URL}movie/${movieId}?language=en-US&api_key=${API_KEY}`);
        res.render("new.ejs", { movie: movieResult.data, movieId, movieTitle: sanitizedTitle, heading: "New Review", submit: "Create Review" });
    } catch (error) {
        console.error("Error fetching movie details for review creation:", error);
        res.status(500).send("Error fetching movie details for review creation");
    }
});

// Add review
app.post("/review/:movieId/:movieTitle/add", async (req, res) => {
    const { name, score, content } = req.body;
    const { movieId, movieTitle } = req.params;

    try {
        await pool.query("INSERT INTO review (name, score, content, movie_id) VALUES ($1, $2, $3, $4);", [name, score, content, movieId]);
        res.redirect(`/review/${movieId}/${movieTitle}`);
    } catch (err) {
        console.error("Error adding review:", err);
        res.status(500).send("Error adding review");
    }
});

// Render the review edit page with movieId
app.post("/review/:movieId/:movieTitle/edit", async (req, res) => {
    const { movieId, movieTitle } = req.params;
    const sanitizedTitle = movieTitle.replace(/[^a-zA-Z0-9 ]/g, "");
    const { editReviewId: reviewId } = req.body;

    try {
        const movieResult = await axios.get(`${API_URL}movie/${movieId}?language=en-US&api_key=${API_KEY}`);
        const reviewResult = await pool.query("SELECT * FROM review WHERE id = $1 AND movie_id = $2;", [reviewId, movieId]);
        res.render("new.ejs", { movie: movieResult.data, review: reviewResult.rows[0], movieId, movieTitle: sanitizedTitle, heading: "Edit Review", submit: "Update Review" });
    } catch (err) {
        console.error("Error fetching movie and review details for editing:", err);
        res.status(500).send("Error fetching movie and review details for editing");
    }
});

// Edit review
app.post("/review/:movieId/:movieTitle/update", async (req, res) => {
    const { score, content } = req.body;
    const { movieId, movieTitle } = req.params;
    const { editReviewId: reviewId } = req.body;

    try {
        await pool.query("UPDATE review SET score = $1, content = $2 WHERE id = $3 AND movie_id = $4;", [score, content, reviewId, movieId]);
        res.redirect(`/review/${movieId}/${movieTitle}`);
    } catch (err) {
        console.error("Error updating review:", err);
        res.status(500).send("Error updating review");
    }
});

// Delete review
app.post("/review/:movieId/:movieTitle/delete", async (req, res) => {
    const { deleteReviewId: reviewId } = req.body;
    const { movieId, movieTitle } = req.params;
    
    try {
        await pool.query("DELETE FROM review WHERE id = $1 and movie_id = $2;", [reviewId, movieId]);
        res.redirect(`/review/${movieId}/${movieTitle}`);
    } catch (err) {
        console.error("Error deleting review:", err);
        res.status(500).send("Error deleting review");
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
