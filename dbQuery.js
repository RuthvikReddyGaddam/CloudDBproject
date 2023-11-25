// 'database-1.crw8xutbz5fo.us-east-2.rds.amazonaws.com'
const mysql = require('mysql');
const dotenv = require('dotenv');
dotenv.config();
const db = mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: process.env.MYSQL_PORT,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE
})

dbQuery = (databaseQuery, values=[]) => {
    if(values.length == 0){
        return new Promise(data => {
            db.query(databaseQuery, function (error, result) { 
                if (error) {

                    throw error;
                }
                try {
                    data(result);
    
                } catch (error) {
                    data({});
                    throw error;
                }
    
            });
        });
    }
    else {
        return new Promise(data => {
            db.query(databaseQuery, [values], function (error, result) {
                if (error) {
                    throw error;
                }
                try {
                    data(result);
    
                } catch (error) {
                    data({});
                    throw error;
                }
    
            });
        });
    }


}


module.exports = dbQuery;
