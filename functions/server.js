const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const serverless = require("serverless-http");

require('dotenv').config();
const moment = require('moment-timezone');

moment.tz.setDefault('Europe/Moscow');
const now = moment().format('YYYY-MM-DD HH:mm:ss.SSS');

console.log(now); // Время в часовом поясе 'Europe/Moscow'

const app = express();
// const PORT = process.env.PORT || 3000;

const router = express.Router();
router.get("/", (req, res) => {
  res.send("App is running..");
});

app.use("/.netlify/functions/app", router);
module.exports.handler = serverless(app);
// Подключение к базе данных PostgreSQL
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASS,
  port: 5432,
});

app.use(cors());

app.use(express.json());
const jwt = require('jsonwebtoken');
const jwtSecret = process.env.JWT_SECRET;

app.use(bodyParser.json());

// Nodemailer configuration
const transporter = nodemailer.createTransport({
  host: "smtp.yandex.ru",
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Send email endpoint
app.post('/api/send-email', async (req, res) => {
  const { to, subject, body } = req.body;

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to,
    subject,
    text: body
  };

  try {
    await transporter.sendMail(mailOptions);
    res.status(200).send({ message: 'Email sent successfully' });
  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).send({ error: 'Failed to send email' });
  }
});

// Маршрут для проверки учетных данных и выдачи токена
app.post('/api/login', async (req, res) => {

  const { username, password } = req.body;
  try {
    // Запрос к базе данных для получения зашифрованного пароля для указанного пользователя
    const result = await pool.query('SELECT * FROM specialist WHERE specialist_login = $1', [username]);

    // Проверка наличия пользователя в базе данных
    if (result.rows.length > 0) {
      const hashedPassword = result.rows[0].specialist_password;

      // Проверка введенного пароля с зашифрованным паролем из базы данных
      const isMatch = await bcrypt.compare(password, hashedPassword);
      if (isMatch) {
        // Если аутентификация успешна, создаем JWT токен
        const specialistId = result.rows[0].specialist_id;
        const token = jwt.sign({ specialistId }, process.env.JWT_SECRET, { expiresIn: '30s' }); // JWT_SECRET - секретный ключ
        res.json({ success: true, token, specialistId });
      } else {
        res.status(401).json({ success: false, message: 'Неправильный логин или пароль' });
      }
    } else {
      res.status(401).json({ success: false, message: 'Неправильный логин или пароль' });
    }
  } catch (error) {
    console.error('Ошибка при выполнении запроса:', error);
    res.status(500).json({ success: false, message: 'Произошла ошибка при проверке учетных данных' });
  }
});


app.get('/api/requests/:specialistId', async (req, res) => {
  const { specialistId } = req.params;
  try {
    // Запрос к базе данных для получения заявок определенного специалиста
    const result = await pool.query('SELECT * FROM request WHERE specialist_id = $1', [specialistId]);
    const specialistName = await pool.query('SELECT specialist_name FROM specialist WHERE specialist_id = $1', [specialistId]);
    res.json({ requests: result.rows, specialistName: specialistName.rows[0].specialist_name });
  } catch (error) {
    console.error('Ошибка при выполнении запроса:', error);
    res.status(500).json({ success: false, message: 'Произошла ошибка при получении заявок' });
  }
});

// Маршрут для получения всех заявок
app.get('/api/all-requests', async (req, res) => {
  try {
    // Запрос к базе данных для получения всех заявок
    const { rows } = await pool.query('SELECT * FROM request');
    res.json({ requests: rows });
  } catch (error) {
    console.error('Ошибка при выполнении запроса к базе данных:', error);
    res.status(500).json({ error: 'Ошибка при получении всех заявок' });
  }
});
// Обработка GET запроса для получения информации о работнике по ID
app.get('/api/worker/:workerId', async (req, res) => {
  const { workerId } = req.params;
  try {
    const result = await pool.query(`
      SELECT worker.worker_name, department.department_name 
      FROM worker 
      LEFT JOIN department ON worker.department_id = department.department_id 
      WHERE worker.worker_id = $1
    `, [workerId]);

    if (result.rows.length > 0) {
      res.json({
        workerName: result.rows[0].worker_name,
        departmentName: result.rows[0].department_name
      });
    } else {
      res.status(404).send('Работник не найден');
    }
  } catch (error) {
    console.error('Ошибка при получении данных о работнике:', error);
    res.status(500).send('Произошла ошибка при получении данных о работнике');
  }
});


// Маршрут для получения должности специалиста по его идентификатору
app.get('/api/jobtitle/:specialistId', async (req, res) => {
  const { specialistId } = req.params;
  try {
    // Запрос к базе данных для получения должности специалиста
    const result = await pool.query(`
    SELECT jobtitle.jobtitle_name 
    FROM jobtitle 
    JOIN specialist ON jobtitle.jobtitle_id = specialist.jobtitle_id 
    WHERE specialist.specialist_id = $1
    `, [specialistId]);

    // Проверяем, была ли найдена должность для указанного специалиста
    if (result.rows.length > 0) {
      res.json({ jobTitle: result.rows[0].jobtitle_name });
    } else {
      res.status(404).json({ message: 'Должность для указанного специалиста не найдена' });
    }
  } catch (error) {
    console.error('Ошибка при получении должности специалиста:', error);
    res.status(500).json({ message: 'Произошла ошибка при получении должности специалиста' });
  }
});

// Маршрут для получения данных о конкретной заявке
app.get('/api/request/:requestId', async (req, res) => {
  const { requestId } = req.params;
  try {
    // Запрос к базе данных для получения данных о заявке по её ID
    const result = await pool.query('SELECT * FROM request WHERE request_id = $1', [requestId]);

    // Проверка наличия данных о заявке
    if (result.rows.length > 0) {
      // Если данные найдены, отправляем их клиенту
      res.json({ success: true, request: result.rows[0] });
    } else {
      // Если заявка не найдена, отправляем сообщение об ошибке
      res.status(404).json({ success: false, message: 'Заявка не найдена' });
    }
  } catch (error) {
    // В случае ошибки отправляем сообщение об ошибке на клиент
    console.error('Ошибка при получении данных о заявке:', error);
    res.status(500).json({ success: false, message: 'Произошла ошибка при получении данных о заявке' });
  }
});

app.put('/api/request/:requestId', async (req, res) => {
  const { requestId } = req.params;
  const { status_id, request_description, start_date, completed_date } = req.body;

  try {
    let updateQuery = 'UPDATE request SET status_id = $1, request_description = $2::text';

    const queryParams = [status_id, request_description];

    // Если передана дата принятия в работу, добавляем ее в запрос
    if (start_date) {
      updateQuery += ', request_acceptdate = $3';
      queryParams.push(start_date);
    }

    // Если передана дата выполнения, добавляем ее в запрос
    if (completed_date) {
      updateQuery += ', request_completedate = $' + (queryParams.length + 1);
      queryParams.push(completed_date);
    }

    updateQuery += ' WHERE request_id = $' + (queryParams.length + 1);

    queryParams.push(requestId);

    await pool.query(updateQuery, queryParams);

    res.status(200).json({ message: 'Запрос успешно обновлен' });
  } catch (error) {
    console.error('Ошибка при обновлении запроса:', error);
    res.status(500).json({ message: 'Произошла ошибка при обновлении запроса' });
  }
});



// Маршрут для получения номера телефона работника по его worker_id
app.get('/api/worker/:workerId/phone', async (req, res) => {
  const workerId = req.params.workerId;
  try {
    const queryResult = await pool.query('SELECT worker_number FROM worker WHERE worker_id = $1', [workerId]);
    if (queryResult.rows.length === 0) {
      res.status(404).json({ message: 'Работник не найден' });
    } else {
      res.status(200).json({ phoneNumber: queryResult.rows[0].worker_number });
    }
  } catch (error) {
    console.error('Ошибка при выполнении запроса:', error);
    res.status(500).json({ message: 'Внутренняя ошибка сервера' });
  }
});

// Маршрут для загрузки списка должностей из базы данных
app.get('/api/jobtitles', async (req, res) => {
  try {
    // Запрос к базе данных для загрузки списка должностей
    const result = await pool.query('SELECT jobtitle_name FROM jobtitle');

    // Отправляем список должностей в формате JSON
    res.json(result.rows);
  } catch (error) {
    // В случае ошибки отправляем статус 500 и сообщение об ошибке
    console.error('Ошибка при загрузке списка должностей из базы данных:', error);
    res.status(500).json({ message: 'Произошла ошибка при загрузке списка должностей из базы данных' });
  }
});

// Маршрут для добавления нового специалиста
app.post('/api/specialists', async (req, res) => {
  const { jobTitleId, fullName, phoneNumber, mail, login, password } = req.body;

  try {
    // Вставка в таблицу specialist
    const specialistResult = await pool.query(`
      INSERT INTO specialist (jobtitle_id, specialist_name, specialist_number, specialist_login, specialist_password, specialist_mail)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING specialist_id
    `, [jobTitleId, fullName, phoneNumber, login, password, mail]);

    const specialistId = specialistResult.rows[0].specialist_id;

    // Вставка в таблицу resolves
    await pool.query(`
      INSERT INTO resolves (problem_id, specialist_id)
      VALUES ($1, $2)
    `, [jobTitleId, specialistId]);

    // Отправка ответа клиенту с данными нового специалиста
    res.status(201).json({ success: true, specialist: specialistResult.rows[0] });
  } catch (error) {
    console.error('Ошибка при добавлении специалиста:', error);
    res.status(500).json({ success: false, message: 'Произошла ошибка при добавлении специалиста' });
  }
});


app.get('/api/jobtitleid', async (req, res) => {
  try {
    const { name } = req.query;
    const query = 'SELECT jobtitle_id FROM jobtitle WHERE jobtitle_name = $1';
    const { rows } = await pool.query(query, [name]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Job title not found' });
    }
    res.json({ id: rows[0].jobtitle_id });
  } catch (error) {
    console.error('Error while querying database:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Маршрут для получения списка специалистов
app.get('/api/specialistslist', async (req, res) => {
  try {
    // Выполнение запроса к базе данных для получения списка специалистов
    const result = await pool.query('SELECT * FROM specialist');

    // Отправка списка специалистов в формате JSON в ответе на запрос
    res.json(result.rows);
  } catch (error) {
    console.error('Ошибка при получении списка специалистов:', error);
    // Отправка статуса 500 (внутренняя ошибка сервера) в случае ошибки
    res.status(500).json({ error: 'Произошла ошибка при получении списка специалистов' });
  }
});

// Маршрут для получения информации о специалисте по его ID
app.get('/api/specialists/:specialistId', async (req, res) => {
  const specialistId = req.params.specialistId;

  try {
    // Запрос к базе данных для получения имени специалиста по его ID
    const queryText = 'SELECT specialist_name FROM specialist WHERE specialist_id = $1';
    const { rows } = await pool.query(queryText, [specialistId]);

    // Проверка наличия результата
    if (rows.length === 0) {
      res.status(404).json({ error: 'Специалист не найден' });
    } else {
      // Отправка имени специалиста в формате JSON
      res.json({ specialistName: rows[0].specialist_name });
    }
  } catch (error) {
    console.error('Ошибка при получении информации о специалисте:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Маршрут для получения названия проблемы по её ID
app.get('/api/problems/:problemId', async (req, res) => {
  const problemId = req.params.problemId;

  try {
    // Запрос к базе данных для получения названия проблемы по её ID
    const queryText = 'SELECT problem_name FROM problem WHERE problem_id = $1';
    const { rows } = await pool.query(queryText, [problemId]);

    // Проверка наличия результата
    if (rows.length === 0) {
      res.status(404).json({ error: 'Проблема не найдена' });
    } else {
      // Отправка названия проблемы в формате JSON
      res.json({ problemName: rows[0].problem_name });
    }
  } catch (error) {
    console.error('Ошибка при получении названия проблемы:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Маршрут для получения списка офисных помещений
app.get('/api/offices', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM office');
    const offices = result.rows;
    client.release();
    res.json({ offices });
  } catch (error) {
    console.error('Ошибка при получении списка офисных помещений:', error);
    res.status(500).json({ message: 'Произошла ошибка при получении списка офисных помещений' });
  }
});

// Маршрут для получения данных об офисе по officeId
app.get('/api/offices/:officeId', async (req, res) => {
  const { officeId } = req.params;
  try {
    const query = 'SELECT * FROM office WHERE office_id = $1';
    const result = await pool.query(query, [officeId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Офис не найден' });
    }
    const office = result.rows[0];
    res.json(office);
  } catch (error) {
    console.error('Ошибка при получении списка офисов:', error);
    res.status(500).json({ error: 'Произошла ошибка при получении списка офисных помещений' });
  }
});

// Добавление нового офиса
app.post('/api/offices', async (req, res) => {
  const { number, name, housing, floor } = req.body;

  try {
    const query = 'INSERT INTO office (office_id, office_name, office_housing, office_floor) VALUES ($1, $2, $3, $4) RETURNING *';
    const values = [number, name, housing, floor];
    const { rows } = await pool.query(query, values);
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('Ошибка при добавлении нового офиса:', error);
    res.status(500).json({ message: 'Произошла ошибка при добавлении нового офиса' });
  }
});

// Изменение данных офиса
app.put('/api/offices/:officeId', async (req, res) => {
  const { officeId } = req.params;
  const { number, name, housing, floor } = req.body;
  try {
    const client = await pool.connect();
    const query = 'UPDATE office SET office_id = $1, office_name = $2, office_housing = $3, office_floor = $4 WHERE office_id = $5 RETURNING *';
    const result = await client.query(query, [number, name, housing, floor, officeId]);
    const updatedOffice = result.rows[0];
    client.release();
    if (!updatedOffice) {
      return res.status(404).json({ error: 'Офис не найден' });
    }
    res.json({ office: updatedOffice });
  } catch (error) {
    console.error('Ошибка при обновлении офиса:', error);
    res.status(500).json({ error: 'Ошибка сервера при обновлении офиса' });
  }
});

// Обработчик DELETE запросов для удаления офисного помещения по его id
app.delete('/api/offices/:officeId', async (req, res) => {
  const { officeId } = req.params;

  try {
    const client = await pool.connect();
    const query = 'DELETE FROM office WHERE office_id = $1';
    const result = await client.query(query, [officeId]);
    client.release();
    res.status(200).json({ message: `Офисное помещение с id ${officeId} успешно удалено` });
  } catch (err) {
    console.error('Ошибка при удалении офисного помещения:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера при удалении офисного помещения' });
  }
});

// Обработка GET запроса для получения списка всех работников
app.get('/api/workers', async (req, res) => {
  try {
    // Выполнение запроса к базе данных с JOIN для получения информации о департаменте
    const result = await pool.query(`
      SELECT worker.worker_id, worker.worker_name, worker.worker_number, department.department_name
      FROM worker
      LEFT JOIN department ON worker.department_id = department.department_id
    `);

    // Отправка списка работников в виде JSON
    res.json(result.rows);
  } catch (error) {
    console.error('Ошибка при получении списка работников:', error);
    // Отправка статуса 500 в случае ошибки
    res.status(500).send('Произошла ошибка при получении списка работников');
  }
});

app.post('/api/JobProblem', async (req, res) => {
  const { jobTitle, problemType } = req.body;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Получаем максимальное значение id из обеих таблиц
    const getMaxIdQuery = `
      SELECT MAX(jobtitle_id) AS max_jobtitle_id FROM jobtitle
      UNION ALL
      SELECT MAX(problem_id) AS max_problem_id FROM problem
    `;
    const maxIdResult = await client.query(getMaxIdQuery);

    // Находим максимальное значение id
    let maxId = 0;
    maxIdResult.rows.forEach(row => {
      if (row.max_jobtitle_id > maxId) {
        maxId = row.max_jobtitle_id;
      }
      if (row.max_problem_id > maxId) {
        maxId = row.max_problem_id;
      }
    });

    // Увеличиваем значение id на 1
    maxId++;

    // Добавляем новую должность
    const jobTitleQuery = 'INSERT INTO jobtitle (jobtitle_id, jobtitle_name) VALUES ($1, $2) RETURNING jobtitle_id';
    await client.query(jobTitleQuery, [maxId, jobTitle]);

    // Добавляем новый тип проблемы
    const problemQuery = 'INSERT INTO problem (problem_id, problem_name) VALUES ($1, $2) RETURNING problem_id';
    await client.query(problemQuery, [maxId, problemType]);

    // Завершаем транзакцию
    await client.query('COMMIT');

    res.status(201).json({ jobId: maxId, problemId: maxId });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Ошибка при добавлении должности и типа проблемы:', error);
    res.status(500).json({ message: 'Произошла ошибка при добавлении должности и типа проблемы' });
  } finally {
    client.release();
  }
});

app.get('/api/JobProblem', async (req, res) => {
  try {
    // Выполнение SQL запроса для объединения таблиц и выборки данных
    const query = `
      SELECT problem_id, jobtitle_name, problem_name
      FROM jobtitle
      INNER JOIN problem ON jobtitle.jobtitle_id = problem.problem_id;
    `;
    const result = await pool.query(query);

    // Возвращаем результат клиенту
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Ошибка при обработке запроса:', error);
    res.status(500).json({ message: 'Произошла ошибка при обработке запроса' });
  }
});

// Обработка PUT запроса для обновления данных о должности и типе проблемы
app.put('/api/JobProblem/:id', async (req, res) => {
  const id = req.params.id;
  const { jobTitle, problemType } = req.body;

  const client = await pool.connect();

  try {
    await client.query('BEGIN'); // Начало транзакции

    // SQL запросы для обновления данных в двух таблицах
    const updateJobTitleQuery = 'UPDATE jobtitle SET jobtitle_name = $1 WHERE jobtitle_id = $2';
    const updateProblemTypeQuery = 'UPDATE problem SET problem_name = $1 WHERE problem_id = $2';

    await Promise.all([
      client.query(updateJobTitleQuery, [jobTitle, id]),
      client.query(updateProblemTypeQuery, [problemType, id]),
    ]);

    await client.query('COMMIT'); // Завершение транзакции

    res.status(200).json({ message: `Данные с id ${id} успешно обновлены` });
  } catch (error) {
    await client.query('ROLLBACK'); // Откат изменений при ошибке
    console.error('Ошибка при обновлении данных:', error);
    res.status(500).json({ error: 'Ошибка при обновлении данных' });
  } finally {
    client.release(); // Возвращение клиента в пул соединений
  }
});

// GET запрос для получения имени должности и типа проблемы по ID проблемы
app.get('/api/JobProblem/:id', async (req, res) => {
  const id = req.params.id;

  try {
    const client = await pool.connect();

    // SQL запрос для получения данных о должности и типе проблемы
    const query = `
      SELECT jobtitle_id AS id, jobtitle_name AS name, 'jobtitle' AS type
      FROM jobtitle
      WHERE jobtitle_id = $1
      UNION ALL
      SELECT problem_id AS id, problem_name AS name, 'problem' AS type
      FROM problem
      WHERE problem_id = $1;
    `;

    const { rows } = await client.query(query, [id]);

    if (rows.length === 0) {
      res.status(404).json({ error: 'Данные не найдены' });
    } else {
      const data = {
        jobtitle: null,
        problem: null
      };

      // Проверяем типы данных и присваиваем их соответствующим полям
      rows.forEach(row => {
        if (row.type === 'jobtitle') {
          data.jobtitle = { id: row.id, name: row.name };
        } else if (row.type === 'problem') {
          data.problem = { id: row.id, name: row.name };
        }
      });

      res.status(200).json(data); // Отправляем данные в формате JSON
    }

    client.release(); // Возвращаем клиента в пул соединений
  } catch (error) {
    console.error('Ошибка при получении данных о должности и типе проблемы:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


// Обработчик DELETE запроса для удаления специалиста
app.delete('/api/specialists/:id', async (req, res) => {
  const specialistId = req.params.id;

  try {
    // Выполнение SQL запроса для удаления специалиста с указанным ID из базы данных
    const queryText = 'DELETE FROM specialist WHERE specialist_id = $1';
    const result = await pool.query(queryText, [specialistId]);

    // Проверка, был ли удален специалист
    if (result.rowCount === 1) {
      res.status(200).json({ message: 'Специалист успешно удален' });
    } else {
      res.status(404).json({ message: 'Специалист с указанным ID не найден' });
    }
  } catch (error) {
    console.error('Ошибка при удалении специалиста:', error);
    res.status(500).json({ message: 'Произошла ошибка при удалении специалиста' });
  }
});

// Обработчик DELETE запроса для удаления статуса
app.delete('/api/status/:id', async (req, res) => {
  const statusId = req.params.id;

  try {
    const queryText = 'DELETE FROM status WHERE status_id = $1';
    const result = await pool.query(queryText, [statusId]);

    if (result.rowCount === 1) {
      res.status(200).json({ message: 'Статус успешно удален' });
    } else {
      res.status(404).json({ message: 'Статус с указанным ID не найден' });
    }
  } catch (error) {
    console.error('Ошибка при удалении статуса:', error);
    res.status(500).json({ message: 'Произошла ошибка при удалении статуса' });
  }
});

// Обработчик DELETE запроса для удаления заявки
app.delete('/api/request/:id', async (req, res) => {
  const requestId = req.params.id;

  try {
    // Выполнение SQL запроса для удаления заявки с указанным ID из базы данных
    const queryText = 'DELETE FROM request WHERE request_id = $1';
    const result = await pool.query(queryText, [requestId]);

    // Проверка, была ли удалена заявка
    if (result.rowCount === 1) {
      res.status(200).json({ message: 'Заявка успешно удалена' });
    } else {
      res.status(404).json({ message: 'Заявка с указанным ID не найдена' });
    }
  } catch (error) {
    console.error('Ошибка при удалении заявки:', error);
    res.status(500).json({ message: 'Произошла ошибка при удалении заявки' });
  }
});

// Обработчик DELETE запроса для удаления заявки
app.delete('/api/jobproblem/:id', async (req, res) => {
  const problemId = req.params.id;

  try {
    // Выполнение SQL запроса для удаления заявки с указанным ID из базы данных
    const queryText = 'DELETE FROM problem WHERE problem_id = $1';
    const queryText1 = 'DELETE FROM jobtitle WHERE jobtitle_id = $1';
    const result = await pool.query(queryText, [problemId]);
    const result1 = await pool.query(queryText1, [problemId]);

    // Проверка, была ли удалена заявка
    if (result.rowCount === 1 & result1.rowCount === 1) {
      res.status(200).json({ message: 'Успешно удалено' });
    } else {
      res.status(404).json({ message: 'Проблема и должность с указанным ID не найдена' });
    }
  } catch (error) {
    console.error('Ошибка при удалении проблемы и должности:', error);
    res.status(500).json({ message: 'Произошла ошибка при удалении проблемы и должности' });
  }
});

// Обработчик GET запроса для получения отчета
app.get('/api/reports', async (req, res) => {
  try {
    const client = await pool.connect();

    // Получаем id статуса "Выполнена"
    const statusQuery = 'SELECT status_id FROM status WHERE status_name = $1';
    const statusResult = await client.query(statusQuery, ['Выполнена']);
    const completedStatusId = statusResult.rows[0]?.status_id;

    if (!completedStatusId) {
      throw new Error('Статус "Выполнена" не найден в базе данных');
    }

    const selectedMonths = req.query.months.split(',').map(Number); // Преобразуем строку в массив чисел
    const query = `
      SELECT 
          EXTRACT(MONTH FROM request_completedate) AS month,
          AVG(EXTRACT(EPOCH FROM (request_completedate - request_acceptdate)) / 3600) AS averageTime
      FROM 
          request
      WHERE 
          EXTRACT(MONTH FROM request_completedate) = ANY($1::int[])
          AND status_id = $2
      GROUP BY 
          EXTRACT(MONTH FROM request_completedate)
      ORDER BY 
          EXTRACT(MONTH FROM request_completedate);
    `;
    const { rows } = await client.query(query, [selectedMonths, completedStatusId]);
    client.release();

    res.json(rows);
  } catch (err) {
    console.error('Ошибка при выполнении запроса:', err);
    res.status(500).send('Внутренняя ошибка сервера');
  }
});


// Обработка GET запроса на /api/reportsSpecialist
app.get('/api/reportsSpecialist', async (req, res) => {
  try {
    const client = await pool.connect();

    // Получаем id статуса "Выполнена"
    const statusQuery = 'SELECT status_id FROM status WHERE status_name = $1';
    const statusResult = await client.query(statusQuery, ['Выполнена']);
    const completedStatusId = statusResult.rows[0]?.status_id;

    if (!completedStatusId) {
      throw new Error('Статус "Выполнена" не найден в базе данных');
    }

    const selectedMonths = req.query.months.split(',').map(Number);
    const queryText = `
      SELECT
        EXTRACT(MONTH FROM request_completedate) AS month,
        AVG(EXTRACT(EPOCH FROM (request_completedate - request_senddate)) / 3600) AS average_time
      FROM request
      WHERE EXTRACT(MONTH FROM request_completedate) = ANY($1::int[])
        AND status_id = $2
      GROUP BY month
      ORDER BY month;
    `;
    const { rows } = await client.query(queryText, [selectedMonths, completedStatusId]);
    client.release();

    // Отправка ответа с данными
    res.json(rows);
  } catch (error) {
    console.error('Ошибка при получении данных отчета:', error);
    res.status(500).json({ error: 'Ошибка при получении данных отчета' });
  }
});


// Маршрут для получения отчета о количестве заявок по типу проблем
app.get('/api/reportsRequestType', async (req, res) => {
  try {
    const result = await pool.query(`
          SELECT p.problem_name AS "problemType", COUNT(r.problem_id) AS "requestCount"
          FROM request r
          JOIN problem p ON r.problem_id = p.problem_id
          GROUP BY p.problem_name
          ORDER BY p.problem_name;
      `);

    res.json(result.rows);
  } catch (error) {
    console.error('Ошибка при выполнении запроса:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/api/reportsRequestMonth', async (req, res) => {
  try {
    const client = await pool.connect();

    const query = `
      SELECT 
        EXTRACT(MONTH FROM r.request_senddate) AS month,
        EXTRACT(YEAR FROM r.request_senddate) AS year,
        COUNT(CASE WHEN s.status_name = 'Выполнена' THEN 1 ELSE NULL END) AS completedCount,
        COUNT(CASE WHEN s.status_name = 'На принятии' THEN 1 ELSE NULL END) AS pendingCount,
        COUNT(CASE WHEN s.status_name = 'В работе' THEN 1 ELSE NULL END) AS inProgressCount
      FROM request r
      JOIN status s ON r.status_id = s.status_id
      GROUP BY month, year
      ORDER BY year, month;
    `;

    const { rows } = await client.query(query);
    client.release();

    res.json(rows);
  } catch (error) {
    console.error('Ошибка при получении данных отчета:', error);
    res.status(500).json({ error: 'Ошибка при получении данных отчета' });
  }
});


// Маршрут для получения списка отделов
app.get('/api/departments', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM department');
    res.json({ departments: result.rows });
  } catch (error) {
    console.error('Ошибка при получении списка отделов:', error);
    res.status(500).json({ error: 'Ошибка при получении списка отделов' });
  }
});

// Маршрут для удаления отдела по ID
app.delete('/api/departments/:id', async (req, res) => {
  const departmentId = req.params.id;
  try {
    await pool.query('DELETE FROM department WHERE department_id = $1', [departmentId]);
    res.status(200).json({ message: `Отдел с ID ${departmentId} успешно удален.` });
  } catch (error) {
    console.error('Ошибка при удалении отдела:', error);
    res.status(500).json({ error: 'Ошибка при удалении отдела' });
  }
});

// Маршрут для получения отдела по его ID
app.get('/api/departments/:departmentId', async (req, res) => {
  const departmentId = req.params.departmentId;

  try {
    const query = 'SELECT * FROM department WHERE department_id = $1';
    const { rows } = await pool.query(query, [departmentId]);

    if (rows.length === 1) {
      res.status(200).json({ department: rows[0] });
    } else {
      res.status(404).json({ error: 'Отдел с указанным ID не найден' });
    }
  } catch (error) {
    console.error('Ошибка при запросе отдела:', error);
    res.status(500).json({ error: 'Произошла ошибка при запросе отдела' });
  }
});

// Маршрут для обновления отдела по его ID
app.put('/api/departments/:departmentId', async (req, res) => {
  const departmentId = req.params.departmentId;
  const { department_name } = req.body;

  try {
    const query = 'UPDATE department SET department_name = $1 WHERE department_id = $2 RETURNING *';
    const { rows } = await pool.query(query, [department_name, departmentId]);

    if (rows.length === 1) {
      res.status(200).json({ department: rows[0] });
    } else {
      res.status(404).json({ error: 'Отдел с указанным ID не найден' });
    }
  } catch (error) {
    console.error('Ошибка при обновлении отдела:', error);
    res.status(500).json({ error: 'Произошла ошибка при обновлении отдела' });
  }
});

// Маршрут для добавления нового отдела
app.post('/api/departments', async (req, res) => {
  const { department_name } = req.body;

  if (!department_name) {
    return res.status(400).json({ error: 'Название отдела обязательно.' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO department (department_name) VALUES ($1) RETURNING *',
      [department_name]
    );

    res.status(201).json({ department: result.rows[0] });
  } catch (error) {
    console.error('Ошибка при добавлении отдела:', error);
    res.status(500).json({ error: 'Ошибка при добавлении отдела' });
  }
});

// Маршрут для получения списка статусов
app.get('/api/statuses', async (req, res) => {
  try {
    const result = await pool.query('SELECT status_id, status_name FROM status');
    res.json(result.rows);
  } catch (error) {
    console.error('Ошибка при получении статусов:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// Маршрут для обновления статуса заявки
app.put('/api/statuses/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status_name } = req.body;

    const queryText = `
      UPDATE status 
      SET status_name = $1 
      WHERE status_id = $2 
      RETURNING *;
    `;

    const result = await pool.query(queryText, [status_name, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Статус не найден' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Ошибка при обновлении статуса:', error);
    res.status(500).json({ error: 'Ошибка при обновлении статуса' });
  }
});

app.post('/api/status', async (req, res) => {
  const { status_name } = req.body;

  if (!status_name) {
    return res.status(400).json({ error: 'Необходимо указать имя статуса' });
  }

  try {
    const client = await pool.connect();
    const query = 'INSERT INTO status (status_name) VALUES ($1)';
    await client.query(query, [status_name]);
    client.release();

    res.status(201).json({ message: 'Статус добавлен успешно' });
  } catch (error) {
    console.error('Ошибка при добавлении статуса:', error);
    res.status(500).json({ error: 'Ошибка при добавлении статуса' });
  }
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
