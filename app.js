import express from "express";
import bodyParser from "body-parser";
import axios from 'axios';
import pg from 'pg';

const { Pool } = pg;

const app = express();
const port = 3000;
const API_URL = "https://api.themoviedb.org/3/";
const API_KEY = "b8f254b4109691ac760b8537a6b443fe";
const imageBaseURL = 'https://image.tmdb.org/t/p/';

const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
});

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));


// Function to fetch genre from API
async function fetchGenre() {
    try {
        const result = await axios.get(`${API_URL}genre/movie/list?api_key=${API_KEY}`);
        const response = result.data;
        const genres = response.genres.map(genre => {
            return {
                id: genre.id,
                name: genre.name
            };
        });
        return genres;
    } catch (err) {
        console.log("Error fetching genres:", err);
        return [];
    }
}

// Function to fetch a random movie poster for a given genre
async function fetchGenreImage(genreId) {
    try {
        const genreInfo = await axios.get(`${API_URL}discover/movie?include_adult=true&include_video=true&api_key=${API_KEY}&page=1&sort_by=popularity.desc&with_genres=${genreId}&language=en-US`);
        const randomMovieIndex = Math.floor(Math.random() * genreInfo.data.results.length);
        const randomMovie = genreInfo.data.results[randomMovieIndex];
        const genreImage = randomMovie.poster_path;
        return genreImage;
    } catch (err) {
        console.log("Error fetching genre image:", err);
        return null;
    }
}

// Rendering main page
app.get("/", async (req, res) => {
    try {
        const genres = await fetchGenre();

        // Fetch genre images for all genres asynchronously
        const genreImagesPromises = genres.map(genre => fetchGenreImage(genre.id));
        const genreImages = await Promise.all(genreImagesPromises);

        res.render("main.ejs", { genres: genres, genreImages: genreImages });
    } catch (error) {
        console.error(error);
        res.status(500).send("Error fetching genres");
    }
});

// Handling search request
app.get("/search", async (req, res) => {
    const movieName = req.query.movieName;

    try {
        
        const searchResult = await axios.get(`${API_URL}search/movie?query=${encodeURIComponent(movieName)}&api_key=${API_KEY}`);
        
        if (searchResult.data.results.length > 0) {
            
            const movieId = searchResult.data.results[0].id;
            const movieTitle = searchResult.data.results[0].title;

            res.redirect(`/review/${movieId}/${encodeURIComponent(movieTitle)}`);
        } else {
            
            res.redirect("/");
        }
    } catch (error) {
        console.error(error);
        res.status(500).send("Error searching for movie");
    }
});

// Rendering genre page
app.get("/genre/:genreId/:genreName", async (req, res) => {
    try {
        const id = req.params.genreId;
        const name = req.params.genreName;
        
        const result = await axios.get(`${API_URL}discover/movie?include_adult=true&include_video=true&api_key=${API_KEY}&page=1&sort_by=popularity.desc&with_genres=${id}&language=en-US`);
        const movies = result.data.results;

        res.render("list.ejs", { title: name, movies: movies });
    } 
    catch (error) {
        console.error(error);
        res.status(500).send("Error fetching movies by genre");
    }
});

// Rendering review page for a specific movie
app.get("/review/:movieId/:movieTitle", async (req, res) => {
    const movieId = req.params["movieId"];

    try {
        const movieResult = await axios.get(`${API_URL}movie/${movieId}?language=en-US&api_key=${API_KEY}`);
        const movie = movieResult.data;

        const reviewsResult = await db.query("SELECT * FROM review WHERE movie_id = $1 ORDER BY id ASC;", [movieId]);
        const reviews = reviewsResult.rows;

        res.render("review.ejs", { movie: movie, review: reviews });
    } catch (error) {
        console.error(error);
        res.status(500).send("Error fetching movie and reviews");
    }
});

// Render the review creation page with movieId
app.get("/review/:movieId/:movieTitle/new", async (req, res) => {
    const movieId = req.params.movieId;
    const movieTitle = req.params.movieTitle.replace(/[^a-zA-Z0-9 ]/g, "");

    try {
        const movieResult = await axios.get(`${API_URL}movie/${movieId}?language=en-US&api_key=${API_KEY}`);
        const movie = movieResult.data;

        res.render("new.ejs", { movie: movie, movieId: movieId, movieTitle: movieTitle, heading: "New Review", submit: "Create Review" });
    } catch (error) {
        console.error(error);
        res.status(500).send("Error fetching movie details for review creation");
    }
});

// Add review
app.post("/review/:movieId/:movieTitle/add", async (req, res) => {
    const name = req.body["name"];
    const score = req.body["score"];
    const content = req.body["content"];
    const movieId = req.params.movieId;
    const movieTitle = req.params.movieTitle;

    try {
        await db.query("INSERT INTO review (name, score, content, movie_id) VALUES ($1, $2, $3, $4) RETURNING *;",
            [name, score, content, movieId]);
    } catch (err) {
        console.log(err);
    }

    res.redirect(`/review/${movieId}/${movieTitle}`);
});

// Render the review edit page with movieId
app.post("/review/:movieId/:movieTitle/edit", async (req, res) => {
    const movieId = req.params.movieId;
    const movieTitle = req.params.movieTitle.replace(/[^a-zA-Z0-9 ]/g, "");
    const reviewId = req.body["editReviewId"];

    try {
        const movieResult = await axios.get(`${API_URL}movie/${movieId}?language=en-US&api_key=${API_KEY}`);
        const movie = movieResult.data;

        const reviewResult = await db.query("SELECT * FROM review WHERE id = $1 AND movie_id = $2;", [reviewId, movieId]);
        const review = reviewResult.rows[0];

        res.render("new.ejs", { movie: movie, review: review, movieId: movieId, movieTitle: movieTitle, heading: "Edit Review", submit: "Update Review" });
    }
    catch (err) {
        console.log(err);
        res.status(500).send("Error fetching movie and review details for editing");
    }
});


// Edit review
app.post("/review/:movieId/:movieTitle/update", async (req, res) => {
    const score = req.body["score"];
    const content = req.body["content"];
    const reviewId = req.body["editReviewId"];
    const movieId = req.params.movieId;
    const movieTitle = req.params.movieTitle;

    try {
        await db.query("UPDATE review SET score = $1, content = $2 WHERE id = $3 AND movie_id = $4;", [score, content, reviewId, movieId]);
        res.redirect(`/review/${movieId}/${movieTitle}`);
    }
    catch (err) {
        console.log(err);
    }
});

// Delete review
app.post("/review/:movieId/:movieTitle/delete", async (req, res) => {
    const reviewId = req.body["deleteReviewId"];
    const movieId = req.params.movieId;
    const movieTitle = req.params.movieTitle;
    
    try {
        await db.query("DELETE FROM review WHERE id = $1 and movie_id = $2;", [reviewId, movieId]);
        res.redirect(`/review/${movieId}/${movieTitle}`);
    }
    catch (err) {
        console.log(err);
    }
});


app.listen(process.env.port, () => {
    console.log(`Server running on port ${port}`);
})