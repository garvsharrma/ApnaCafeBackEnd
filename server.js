// server.js

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { Pool } = require('pg');
const { google } = require('googleapis');
const { OAuth2 } = google.auth;
const axios = require('axios');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: 'https://garvsharrma.github.io', // Your GitHub Pages domain
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}));
app.use(bodyParser.json());

// Nodemailer transporter setup for Ethereal
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS
  }
});

// Function to send confirmation email on contact us
const sendContactConfirmationEmail = async (to, name) => {
  try {
    const info = await transporter.sendMail({
      from: "Apna Cafe <your-email@gmail.com>",
      to: to,
      subject: 'Thank You for Contacting Us',
      text: `Dear ${name},\n\nThank you for reaching out to us! We will get back to you shortly.\n\nBest regards,\nApna Cafe Team`,
    });

    console.log('Email sent:', info.messageId);
  } catch (error) {
    console.error('Error sending email:', error);
  }
};

//Function to Send Email on order confirmation
const sendOrderConfirmationEmail = async (to, orderId, amount) => {
  try {
    const info = await transporter.sendMail({
      from: "Apna Cafe",
      to:to,
      subject: 'Order Confirmation',
      text:`Thank you for your order! Your order with Order ID ${orderId} has been successfully placed. The total amount is ₹${amount}. We're preparing your items with care and will notify you once they're ready for pickup or delivery.`
    });

    console.log('Email sent:', info.messageId);
    console.log('Preview URL:', nodemailer.getTestMessageUrl(info));
  } catch (error) {
    console.error('Error sending email:', error);
  }
};

const sendReservationConfirmationEmail = async (to, reservationId, reservationDetails) => {
  try {
    const info = await transporter.sendMail({
      from: "Apna Cafe",
      to: to,
      subject: 'Reservation Confirmation',
      text: `Your reservation with reservation ID ${reservationId} has been successfully made. Here are the details:\n\nDate: ${reservationDetails.date}\nTime: ${reservationDetails.time}\nGuests: ${reservationDetails.guests}\n\nWe look forward to serving you at Apna Cafe.`
    });

    console.log('Reservation email sent:', info.messageId);
    console.log('Preview URL:', nodemailer.getTestMessageUrl(info));
  } catch (error) {
    console.error('Error sending reservation email:', error);
  }
};

// API route to handle contact form submission
app.post('/api/contact', async (req, res) => {
  const { name, email, message } = req.body;

  try {
    // Save the contact form submission to the database
    const result = await pool.query(
      'INSERT INTO contact_messages (name, email, message) VALUES ($1, $2, $3) RETURNING *',
      [name, email, message]
    );

    // Send confirmation email to the user
    await sendContactConfirmationEmail(email, name);

    // Send success response
    res.status(200).json({ message: 'Contact form submitted successfully', data: result.rows[0] });
  } catch (error) {
    console.error('Error handling contact form submission:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/test-email', (req, res) => {
  const testEmail = 'garvsharma011@gmail.com'; 
  const testOrderId = '12345';
  const testAmount = '150.0';
  console.log("Sending test email....");
  sendOrderConfirmationEmail(testEmail, testOrderId, testAmount);
  res.send('Test email sent');
});

// PostgreSQL connection
const pool = new Pool({
  user: 'garvsharma', 
  host: 'dpg-crnui9ij1k6c739cjtig-a',
  database: 'apna_cafe_db',
  password: 'bOROg43ERp1gU5Q7bJJBiFNwzwXQy7XW', 
  port: 5432,
});

// Route to handle order creation
app.post('/api/create-order', async (req, res) => {
  const { customer, cart } = req.body;

  try {
    // Start a transaction
    await pool.query('BEGIN');

    // Insert customer data into orders table
    const result = await pool.query(
      'INSERT INTO orders (customer_name, customer_email, customer_phone, customer_address) VALUES ($1, $2, $3, $4) RETURNING id',
      [customer.name, customer.email, customer.phone, customer.address]
    );
    
    const orderId = result.rows[0].id;

    // Insert order items into order_items table
    for (const { item, quantity } of cart) {
      await pool.query(
        'INSERT INTO order_items (order_id, item_id, quantity, price) VALUES ($1, $2, $3, $4)',
        [orderId, item.id, quantity, item.price]
      );
    }

    // Commit transaction
    await pool.query('COMMIT');

    res.status(201).json({ orderId: orderId.toString(), amount: cart.reduce((total, { item, quantity }) => total + item.price * quantity, 0) });
  } catch (error) {
    // Rollback transaction in case of error
    await pool.query('ROLLBACK');
    console.error('Error creating order:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


app.post('/api/initiate-payment', async (req, res) => {
  const { orderId, amount, customerEmail, customerPhone } = req.body;

  try { 
    console.log('Initiating payment with Cashfree...');
    console.log('Order ID:', orderId);
    console.log('Email:', amount);
    console.log('Phone:', amount);
    console.log('Amount:', amount);


    const response = await axios.post(
      'https://sandbox.cashfree.com/pg/orders',
      {
        order_id: orderId,
        order_amount: amount,
        order_currency: 'INR',
        customer_details: {
          customer_id: orderId,
          customer_email: customerEmail,
          customer_phone: customerPhone 
        },
        order_note: 'Order Payment',
        order_meta: {
          return_url: `https://apnacafebackend.onrender.com/payment-success?order_id=${orderId}`
        },
        version: '2023-08-01'
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': process.env.CASHFREE_APP_ID,
          'x-client-secret': process.env.CASHFREE_SECRET_KEY,
          'x-api-version': '2023-08-01'
        }
      }
    );

    console.log('Cashfree response:', response.data);
    const { payment_session_id } = response.data;

    if (payment_session_id) {
      res.status(200).json({ paymentSessionId: payment_session_id });
    } else {
      console.error('Payment session ID not returned');
      res.status(500).json({ error: 'Payment session ID not returned' });
    }
  } catch (error) {
    console.error('Error initiating payment:', error.response ? error.response.data : error.message);
    res.status(500).json({ error: 'Failed to initiate payment' });
  }
});

app.post('/api/payment-success', async (req, res) => {
  console.log("Payment-Sucess");
  const { orderId, amount, customerEmail } = req.body;

  try {
    // Assuming the payment was successful, send the order confirmation email
    sendOrderConfirmationEmail(customerEmail, orderId, amount);

    res.status(200).json({ message: 'Payment successful and email sent' });
  } catch (error) {
    console.error('Error handling payment success:', error);
    res.status(500).json({ error: 'Failed to handle payment success' });
  }
});


// Route to handle form submission

app.post('/api/reservations', async (req, res) => {
  console.log('Received POST request to /api/reservations', req.body);
  try {
    const { name, email, phone, date, time, guests } = req.body;
    const result = await pool.query(
      'INSERT INTO reservations (name, email, phone, date, time, guests) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [name, email, phone, date, time, guests]
    );

    const reservation = result.rows[0];

    // Send confirmation email
    await sendReservationConfirmationEmail(
      reservation.email,
      reservation.id,  // Assuming `id` is the primary key of the reservation table
      {
        date: reservation.date,
        time: reservation.time,
        guests: reservation.guests
      }
    );

    res.status(201).json(reservation);
  } catch (error) {
    console.error('Error saving reservation:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});



  // server.js
  const items = [
    { id: 1, name: 'CAFFE LATTE', price: 339.9, imageUrl: 'https://img.freepik.com/premium-photo/hot-coffee-capuccino-cup-with-latte-art-wood-table-cafe_778722-16.jpg' },
    { id: 2, name: 'CAFFE MOCHA', price: 449.9, imageUrl: 'https://krave.com.bd/wp-content/uploads/2020/06/Cafe-Mocha.jpg' },
    { id: 3, name: 'WHITE CHOCOLATE MOCHA', price: 599.9, imageUrl: 'https://www.littlesugarsnaps.com/wp-content/uploads/2022/01/white-chocolate-mocha-square.jpg' },
    { id: 4, name: 'EGGS BENEDICT', price: 339.9, imageUrl: 'https://www.foodandwine.com/thmb/j6Ak6jECu0fdly1XFHsp4zZM8gQ=/1500x0/filters:no_upscale():max_bytes(150000):strip_icc()/Eggs-Benedict-FT-RECIPE0123-4f5f2f2544464dc89a667b5d960603b4.jpg' },
    { id: 5, name: 'PANCAKES AND FRESH BERRIES', price: 449.9, imageUrl: 'https://static.vecteezy.com/system/resources/previews/030/625/221/large_2x/pancakes-image-hd-free-photo.jpg' },
    { id: 6, name: 'GREEK YOGURT', price: 459.9, imageUrl: 'https://muscleupmeals.com/wp-content/uploads/2022/07/Greek-Yogurt-Nutrition.600.jpg' },
    { id: 7, name: 'CHOCOLATE LAVA CAKE', price: 299.9, imageUrl: 'https://www.bakels.in/wp-content/uploads/sites/15/2019/10/unnamed.jpg' },
    { id: 8, name: 'CLASSIC CHEESE CAKE', price: 339.9, imageUrl: 'https://natashaskitchen.com/wp-content/uploads/2020/05/Pefect-Cheesecake-7.jpg' },
    { id: 9, name: 'TIRAMISU', price: 369.9, imageUrl: 'https://img.freepik.com/premium-photo/italian-tiramisu-dessert-realistic-photo-hd-picture_1021165-312.jpg' },
  ];
  

app.get('/api/items', (req, res) => {
  res.json(items);
});
  
let cart = [];

app.post('/api/cart', (req, res) => {
  const { itemId, quantity } = req.body;
  const item = items.find(i => i.id === itemId);
  if (item) {
    const cartItem = cart.find(ci => ci.item.id === itemId);
    if (cartItem) {
      cartItem.quantity += quantity;
    } else {
      cart.push({ item, quantity });
    }
    res.json(cart);
  } else {
    res.status(404).json({ error: 'Item not found' });
  }
});

app.get('/api/cart', (req, res) => {
  res.json(cart);
});

app.delete('/api/cart/:itemId', (req, res) => {
  const { itemId } = req.params;
  cart = cart.filter(ci => ci.item.id !== parseInt(itemId));
  res.json(cart);
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
