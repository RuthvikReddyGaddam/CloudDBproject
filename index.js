const dbQuery = require('./dbQuery');
const ejsMate = require('ejs-mate');
const express = require('express');
const validator = require('validator');
const methodOverride = require("method-override");
const path = require('path');
const app = express();
const flash = require('connect-flash');
const mysql = require('mysql')
const bcrypt = require("bcrypt");
const cookieParser = require('cookie-parser');
const session = require('express-session');
const { strict } = require('assert');
const ExpressError = require('./utils/ExpressError');
const catchAsync = require('./utils/catchAsync');
const multer = require("multer");
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const sharp = require('sharp');
const sendEmail = require("./sendEMail");
const dotenv = require('dotenv');
dotenv.config();

const bucketName = process.env.BUCKET_NAME;
const bucketRegion = process.env.BUCKET_REGION;
const accessKey = process.env.ACCESS_KEY;
const secretAccessKey = process.env.SECRET_ACCESS_KEY;
const port = process.env.PORT;

const s3 = new S3Client({
    credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretAccessKey,
    },
    region: bucketRegion

})



function randomImageName(bytes = 32) { return crypto.randomBytes(bytes).toString('hex'); }

app.engine("ejs", ejsMate);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride("_method"));
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

app.use(flash());
app.use(cookieParser());

app.use(session({
    secret: "ajfnbhvgoliueafhbiadfbikbkbfhep32985tyh@#OUY(&#TGBI@G$R(FUVB*I(O)Gyhikea",
    cookie: {
        sameSite: 'strict',
        httpOnly: true,
        // secure: true,
        expires: Date.now() + 1000 * 60 * 24 * 7,
        maxAge: 1000 * 60 * 24 * 7,
    },
    saveUninitialized: true,
    resave: true
}));

app.use((req, res, next) => {
    res.locals.user = req.session.user;
    res.locals.success = req.flash('success');
    res.locals.error = req.flash('error');
    next();
})

const isLoggedIn = (req, res, next) => {
    if (!req.session.isAuthenticated) {
        req.session.returnTo = req.originalUrl;
        req.flash('error', 'you must be signed in');
        return res.redirect('/login');
    }
    next();
}


app.get('/home', (req, res) => {
    res.render('home');
});

/////////////////////////LOGIN////////////////////////////////////////////
app.get('/login', (req, res) => {
    if (req.session.isAuthenticated) {
        req.flash('success', "You are already signed in");
        res.redirect("/requests");
    }
    else {
        res.render('user/login');
    }

});

app.post('/login', catchAsync(async (req, res, next) => {
        if (req.session.isAuthenticated) {
            req.flash('success', "You are already signed in");
            res.redirect("/requests");
        }
        else {
            let { email, password } = req.body;
            let values = [validator.escape(email)];
            if (validator.isEmail(values[0])) {
                let sql = "SELECT * FROM users WHERE email = ?";
                let row = await dbQuery(sql, values);
                const rows = JSON.parse(JSON.stringify(row));
                if (rows.length == 0) {
                    req.flash("error", "User does not exist. Register Instead.");
                    res.redirect('/login');
                }
                else {
                    const hashedPassword = rows[0].password;
                    if (await bcrypt.compare(password, hashedPassword)) {
                        req.session.user = rows[0].userID;
                        req.session.isAuthenticated = true;
                        const redirectUrl = req.session.returnTo || '/requests';
                        delete req.session.returnTo;
                        req.flash('success', "You are signed in. Welcome!");
                        res.redirect(redirectUrl);
                    }
                    else {
                        req.flash('error', "Please Sign In!");
                        res.redirect("/login")
                    }
                }
            } else {
                req.flash('erroer', "wrong credentials");
                res.redirect("/login");
            }

        }
    }));

/////////////////////////REGISTER////////////////////////////////////////////
app.get('/register', (req, res) => {
    res.render('user/register');
});


function isFileImage(file) {
    return file.split('/')[0] === 'image';
}


app.post("/register", upload.single('profileUrl'), catchAsync(async (req, res) => {

    let { email, firstName, lastName, address, city, state, pincode } = req.body;
    const hashedPassword = await bcrypt.hash(req.body.password, 10);
    let values = [validator.escape(firstName), validator.escape(lastName), validator.escape(email), hashedPassword, validator.escape(address), validator.escape(city), validator.escape(pincode), validator.escape(state)]
    if ((validator.isEmail(values[2])) &&
        (values[0].length !==0 && typeof values[0] == 'string') &&
        (values[1].length !==0 && typeof values[1] == 'string') &&
        (values[4].length !==0 && typeof values[4] == 'string') &&
        (values[5].length !==0 && typeof values[5] == 'string') &&
        (Number.isInteger(parseInt(values[6]))) &&
        (values[7].length !==0 && typeof values[7] == 'string')) {
        let sql = "SELECT * FROM users WHERE email = ?"
        let rows = await dbQuery(sql, [values[2]]);
        if (rows.length != 0) {
            req.flash('error', "user exists. Try again");
            res.redirect("/register");
        }
        else {
            let imageName = 'default-profile-account-unknown-icon-black-silhouette-free-vector.jpg'
            if (req.file && isFileImage(req.file.mimetype)) {
                const buffer = await sharp(req.file.buffer).resize({ height: 200, width: 200, fit: 'contain' }).toBuffer();
                imageName = randomImageName();
                const params = {
                    Bucket: bucketName,
                    Key: imageName,
                    Body: buffer,
                    ContentType: req.file.mimetype,
                }
                const command = new PutObjectCommand(params);
                const uploadRes = await s3.send(command);
            }


            sql = "INSERT INTO users (firstName, lastName, email, password, address, city, pincode, profileUrl, state) VALUES (?)"
            values = [validator.escape(firstName), validator.escape(lastName), validator.escape(email), hashedPassword, validator.escape(address), validator.escape(city), validator.escape(pincode), imageName, validator.escape(state)]
            await dbQuery(sql, values);
            sendEmail();
            req.flash("success", "You have Registered. Please Log in to continue");
            res.redirect("/login");
        }
    }
    else {
        req.flash("error", "wrong credentials");
        res.redirect('/register');
    }


}));

/////////////////////////USERS///////////////////////////////////////////////
app.get('/profile', isLoggedIn, catchAsync(async (req, res) => {
    let sql = "SELECT * FROM users WHERE userID = ?;";
    let rows = await dbQuery(sql, [req.session.user]);
    const data = JSON.parse(JSON.stringify(rows));

    const getObjectParams = {
        Bucket: bucketName,
        Key: data[0].profileUrl
    }
    const command = new GetObjectCommand(getObjectParams);
    const url = await getSignedUrl(s3, command, { expiresIn: 3600 });
    data[0].imageUrl = url;

    sql = "SELECT * FROM posts WHERE userID = ?;";
    rows = await dbQuery(sql, [req.session.user]);
    const post = JSON.parse(JSON.stringify(rows));
    res.render("user/profile", { data, post });
}));

app.delete('/profile/delete/:id', isLoggedIn, catchAsync(async (req, res) => {
    let sql = "SELECT * FROM users WHERE userID = ?;";
    let rows = await dbQuery(sql, [req.params.id]);

    let data = JSON.parse(JSON.stringify(rows));
    if (req.session.user === data[0].userID) {
        if (data[0].profileUrl != "default-profile-account-unknown-icon-black-silhouette-free-vector.jpg") {
            let getObjectParams = {
                Bucket: bucketName,
                Key: data[0].profileUrl
            }

            const command = new DeleteObjectCommand(getObjectParams);
            await s3.send(command);

        }

        sql = "SELECT photoUrl FROM posts WHERE userID = ?";
        let values = [req.session.user];
        rows = await dbQuery(sql, values);

        for (i = 0; i < rows.length; i++) {
            getObjectParams = {
                Bucket: bucketName,
                Key: rows[i].photoUrl
            }

            const command = new DeleteObjectCommand(getObjectParams);
            await s3.send(command);

        }

        sql = "DELETE FROM users WHERE userID = ?";
        values = req.params.id;
        await dbQuery(sql, [values]);
        res.redirect("/logout");
    }
    else {
        req.flash("error", "Invalid Request");
        res.redirect("/requests");
    }


}));



/////////////////////////REQUESTS////////////////////////////////////////////    
app.get('/requests', catchAsync(async (req, res) => {
    const sql = "SELECT * FROM posts;";
    const rows = await dbQuery(sql);
    const data = JSON.parse(JSON.stringify(rows));
    if(data.photoUrl !== "no image"){
        for (let i = 0; i < data.length; i++) {
            const getObjectParams = {
                Bucket: bucketName,
                Key: data[i].photoUrl
            }
            const command = new GetObjectCommand(getObjectParams);
            const url = await getSignedUrl(s3, command, { expiresIn: 3600 });
            data[i].imageUrl = url;
        }
    }
    res.render("routes/requests", { data });
}));

app.get('/requests/new', isLoggedIn, (req, res) => {
    res.render('routes/new');
});


app.post('/requests', isLoggedIn, upload.single("photoUrl"), catchAsync(async (req, res, next) => {
    const { title, postData } = req.body;
    let values = [validator.escape(title), validator.escape(postData)];

    if (values[0].length !== 0 && typeof values[0] == "string" && values[1].length !== 0 &&  typeof values[1] == "string") {
        let imageName = "no image";
        if(req.file && isFileImage(req.file.mimetype)){
            const buffer = await sharp(req.file.buffer).resize({ height: 1200, width: 1200, fit: 'contain' }).png().toBuffer();
            imageName = randomImageName();
            const params = {
                Bucket: bucketName,
                Key: imageName,
                Body: buffer,
                ContentType: req.file.mimetype,
            }
            const command = new PutObjectCommand(params);
            await s3.send(command);
    
        }
        
        const sql = "INSERT INTO posts (userID, postData, photoUrl, title) VALUES (?)";
        values = [req.session.user, postData, imageName, title];
        const rows = await dbQuery(sql, values);
        const data = JSON.parse(JSON.stringify(rows));
        res.redirect(`/requests/${data.insertId}`);
    } else {
        req.flash("error", "Invalid inputs. Try again");
        res.redirect("/requests/new")
    }


}));

app.get('/requests/:id', catchAsync(async (req, res) => {
    const values = [validator.escape(req.params.id)];
    let sql = "SELECT * FROM posts JOIN users ON posts.userID = users.UserID WHERE posts.postID = ?;";
    let rows = await dbQuery(sql, [values]);
    let data = JSON.parse(JSON.stringify(rows));
    let getObjectParams = {
        Bucket: bucketName,
        Key: data[0].photoUrl
    }
    let command = new GetObjectCommand(getObjectParams);
    let url = await getSignedUrl(s3, command, { expiresIn: 3600 });

    data[0].imageUrl = url;

    getObjectParams = {
        Bucket: bucketName,
        Key: data[0].profileUrl
    }
    command = new GetObjectCommand(getObjectParams);
    url = await getSignedUrl(s3, command, { expiresIn: 3600 });

    data[0].posterUrl = url;



    sql = "SELECT replyID, replyData, replies.userID, firstName, lastName, email, profileUrl FROM replies JOIN users ON replies.userID = users.userID WHERE replies.postID = ?";
    rows = await dbQuery(sql, [values]);
    const reply = JSON.parse(JSON.stringify(rows));

    for (let i = 0; i < reply.length; i++) {
        getObjectParams = {
            Bucket: bucketName,
            Key: reply[i].profileUrl
        }
        command = new GetObjectCommand(getObjectParams);
        url = await getSignedUrl(s3, command, { expiresIn: 3600 });
        reply[i].userUrl = url
    }
    res.render("routes/show", { data, reply });

}));

app.get('/requests/:id/edit', isLoggedIn, catchAsync(async (req, res) => {
    const sql = "SELECT * FROM posts WHERE postID = ?;";
    const values = [req.params.id];
    const rows = await dbQuery(sql, values);
    const data = JSON.parse(JSON.stringify(rows));

    if (req.session.user !== data[0].userID) {
        res.redirect(`/requests/${req.params.id}`);
    }
    else {
        const getObjectParams = {
            Bucket: bucketName,
            Key: data[0].photoUrl
        }
        const command = new GetObjectCommand(getObjectParams);
        const url = await getSignedUrl(s3, command, { expiresIn: 3600 });
        data[0].imageUrl = url;
        res.render("routes/edit", { data });
    }
}));

app.put('/requests/:id', isLoggedIn, upload.single("photoUrl"), catchAsync(async (req, res) => {
    let sql = "SELECT userID FROM posts WHERE postID = ?;";
    let values = [validator.escape(req.params.id)];
    let rows = await dbQuery(sql, values);
    const data = JSON.parse(JSON.stringify(rows));
    const title = validator.escape(req.body.title);
    const postData = validator.escape(req.body.postData);

    if (req.session.user !== data[0].userID || !(title.length !== 0 && typeof title == "string" && postData.length !== 0 && typeof postData == "string")) {
        res.redirect(`/requests/${req.params.id}`)
    }
    else {

        const imageName = data[0].photoUrl;
        if (req.file) {
            const buffer = await sharp(req.file.buffer).resize({ height: 1200, width: 1200, fit: 'contain' }).toBuffer();
            const params = {
                Bucket: bucketName,
                Key: imageName,
                Body: buffer,
                ContentType: req.file.mimetype,
            }
            const command = new PutObjectCommand(params);
            await s3.send(command);
        }
        values = [postData, title, parseInt(req.params.id)];
        sql = mysql.format("UPDATE posts SET posts.postData= ?, posts.title= ? WHERE posts.postID = ?;", values);
        rows = await dbQuery(sql);
        res.redirect(`/requests/${req.params.id}`);
    }
}
));

app.delete('/requests/:id', isLoggedIn, catchAsync(async (req, res) => {

    let sql = "SELECT * FROM posts WHERE postID = ?;";
    let values = [req.params.id];
    let rows = await dbQuery(sql, values);
    const data = JSON.parse(JSON.stringify(rows));

    if (req.session.user !== data[0].userID) {
        req.flash('error', "You are atuhorized Delete this post!");
        res.redirect(`/requests/${req.params.id}`)
    }
    else {
        const params = {
            Bucket: bucketName,
            Key: data[0].photoUrl
        }
        const command = new DeleteObjectCommand(params);
        await s3.send(command);
        sql = "DELETE FROM posts WHERE posts.postID=?";
        const values = req.params.id;
        rows = await dbQuery(sql, [values]);
        req.flash('success', "Post Deleted!");
        res.redirect(`/requests`);
    }
}
));

/////////////////////////REPLIES////////////////////////////////////////////
app.post('/replies/:id', isLoggedIn, catchAsync(async (req, res) => {
    const values = [req.params.id, validator.escape(req.body.replyData), req.session.user];
    if (values[1].length !== 0 && typeof values[1] == "string") {
        const sql = "INSERT INTO replies (postID, replyData, userID) VALUES (?)";
        await dbQuery(sql, values)
        res.redirect(`/requests/${req.params.id}`);
    }
    else {
        req.flash("error", "Invalid inputs. Please try again")
        res.redirect(`/requests/${req.params.id}`);
    }

})
);

app.delete('/replies/:postid/:id', isLoggedIn, catchAsync(async (req, res) => {
    let sql = "SELECT userID FROM replies WHERE replyID = ?;";
    let values = [req.params.id];
    let rows = await dbQuery(sql, values);
    const data = JSON.parse(JSON.stringify(rows));

    if (req.session.user !== data[0].userID) {
        res.redirect(`/requests/${req.params.id}`)
    }
    else {
        const sql = "DELETE FROM replies WHERE replyID = ?";
        const values = [parseInt(req.params.id)];
        await dbQuery(sql, values)
        res.redirect(`/requests/${req.params.postid}`);
    }
}));

/////////////////////////DONOR////////////////////////////////////////////

app.get('/donor', isLoggedIn, (req, res) => {
    res.render('donor/register');
});

app.post('/donor/register', isLoggedIn, catchAsync(async (req, res) => {
    const sql = "SELECT userID FROM donors WHERE userID = ?;"
    let values = [req.session.user]
    const rows = await dbQuery(sql, values);
    const data = JSON.parse(JSON.stringify(rows));

    if (data.length === 0) {
        const gender = validator.escape(req.body.gender);
        const weight = validator.escape(req.body.weight);
        const height = validator.escape(req.body.height);
        const bloodGroup = validator.escape(req.body.bloodGroup);
        const previousHealthIssues = validator.escape(req.body.previousHealthIssues);
        const smoking = validator.escape(req.body.smoking);
        const Drinking = validator.escape(req.body.Drinking);

        if ((gender.length !== 0 && typeof gender == "string") &&
            (Number.isInteger(parseInt(weight))) &&
            (Number.isInteger(parseInt(height))) &&
            (bloodGroup.length !== 0 && typeof bloodGroup == "string") &&
            (previousHealthIssues.length !== 0 && typeof previousHealthIssues == "string") &&
            (smoking.length !== 0 && typeof smoking == "string") &&
            (Drinking.length !== 0 && typeof Drinking == "string")) {
            const today = new Date();
            const birthDate = new Date(req.body.DoB);
            const age = today.getFullYear() - birthDate.getFullYear();
            const m = today.getMonth() - birthDate.getMonth();
            if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
                age--;
            }
            if (age < 17) {
                req.flash('error', "Age is less than 17 years!");
                res.redirect('/donor');
            }
            else {
                values = [req.session.user, gender, height, weight, bloodGroup, birthDate, previousHealthIssues, smoking, Drinking, age];
                const sql = "INSERT INTO donors (userID, gender, height, weight, bloodGroup, DoB, previousHealthIssues, smoking, Drinking, age) VALUES (?)"
                await dbQuery(sql, values);
                res.redirect('/requests');
            }
        } else {
            req.flash('error', "Invalid inputs. Try again");
            res.redirect('/donor');
        }
    } else {
        req.flash('error', "You are already registered");
        res.redirect('/requests');
    }


}));

/////////////////////////DONORSEARCH////////////////////////////////////////////
app.get('/donors/search', isLoggedIn, (req, res) => {
    res.render('donor/search');
});

app.post('/donors/search', isLoggedIn, catchAsync(async (req, res) => {
    const values = [validator.escape(req.body.bloodGroup), validator.escape(req.body.city), validator.escape(req.body.state)];
    if ((values[0].length !== 0 && typeof values[0] == "string") && (values[1].length !== 0 && typeof values[1] == "string") && (values[2].length !== 0 && typeof values[2] == "string")) {
        const sql = `SELECT * FROM donors JOIN users ON donors.userID = users.userID WHERE donors.bloodGroup = "${values[0]}" AND (users.city = "${values[1]}" OR users.state = "${values[2]}");`
        const rows = await dbQuery(sql);
        const data = JSON.parse(JSON.stringify(rows));
        for (let i = 0; i < data.length; i++) {
            getObjectParams = {
                Bucket: bucketName,
                Key: data[i].profileUrl
            }
            command = new GetObjectCommand(getObjectParams);
            url = await getSignedUrl(s3, command, { expiresIn: 3600 });
            data[i].userUrl = url;
        }
        res.render('donor/search', { data });
    }
    else {
        req.flash("error", "invalid request");
        res.redirect("/donors/search");
    }
}));

app.get("/logout", (req, res, next) => {
    if (req.session.user) {
        req.session.destroy()
        res.clearCookie('connect.sid');
        res.redirect('/login');
    }
});

app.all("*", (req, res, next) => {
    next(new ExpressError('Page Not Found', 404))
})

app.use((err, req, res, next) => {
    const { statusCode = 500, message } = err;
    if (!err.message) err.message = "Page Not Found"
    res.status(statusCode).render('error', { err })
})

app.listen(port, () => {
    console.log('Server active')
});