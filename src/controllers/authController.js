import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { User } from '../models/index.js';

// Setup email transporter using env config
const createTransporter = () => {
  const host = (process.env.SMTP_HOST || process.env.SMTP_SERVER || '').trim();
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASSWORD || process.env.SMTP_PASS || '').trim();

  if (host && user && pass) {
    return nodemailer.createTransport({
      host: host,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_PORT === '465',
      auth: {
        user: user,
        pass: pass,
      },
    });
  }
  return null;
};

// Central helper to send OTP
const sendOtpEmail = async (email, otp, type) => {
  let subject = 'TWMS Security Code';
  let description = '';
  
  if (type === 'login') {
    subject = 'TWMS Login Verification OTP';
    description = 'logging in';
  } else if (type === 'register') {
    subject = 'TWMS Registration Verification OTP';
    description = 'completing registration';
  } else if (type === 'forgot_password') {
    subject = 'TWMS Password Reset OTP';
    description = 'resetting your password';
  }

  const text = `Your OTP verification code for Textile Warehouse Management System is: ${otp}. It is valid for 10 minutes.`;
  const html = `
    <div style="font-family: 'Inter', sans-serif; padding: 24px; background-color: #f8fafc; border-radius: 12px; max-width: 500px; margin: auto;">
      <h2 style="color: #1e3a8a; margin-bottom: 16px;">Textile Warehouse Management</h2>
      <p style="color: #334155; font-size: 15px; line-height: 1.5;">You requested an OTP verification code for <b>${description}</b>.</p>
      <div style="margin: 24px 0; padding: 16px; background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; text-align: center;">
        <span style="font-size: 32px; font-weight: 800; letter-spacing: 4px; color: #2563eb;">${otp}</span>
      </div>
      <p style="color: #64748b; font-size: 13px;">This code is valid for 10 minutes. If you did not request this code, please ignore this email.</p>
    </div>
  `;

  // Always log OTP to server console for easy dev testing
  console.log(`\n======================================\n[EMAIL OTP] To: ${email}\n[ACTION]: ${type.toUpperCase()}\n[OTP CODE]: ${otp}\n======================================\n`);

  // 1. Try Resend API first if RESEND_API_KEY is defined
  try {
    const resendApiKey = (process.env.RESEND_API_KEY || '').trim();
    if (resendApiKey) {
      console.log('[Email Auth] Attempting to send email via Resend API...');
      const resend = new Resend(resendApiKey);

      let fromAddress = 'Textile Warehouse <onboarding@resend.dev>';
      const fromStr = process.env.SMTP_FROM || '';
      if (fromStr) {
        const isPublicDomain = /@(gmail|yahoo|outlook|hotmail|aol|live|icloud|mail)\.com/i.test(fromStr);
        if (!isPublicDomain) {
          fromAddress = fromStr;
        } else {
          const nameMatch = fromStr.match(/"([^"]+)"/) || fromStr.match(/^([^<]+)/);
          const senderName = nameMatch ? nameMatch[1].trim() : "Textile Warehouse";
          fromAddress = `"${senderName}" <onboarding@resend.dev>`;
        }
      }

      await resend.emails.send({
        from: fromAddress,
        to: [email],
        subject: subject,
        html: html,
        text: text
      });
      console.log('✅ Success: OTP email sent via Resend API.');
      return true;
    }
  } catch (apiError) {
    console.error('[Email Auth] Resend API failed, trying SMTP fallback:', apiError.message);
  }

  // 2. Fallback to Nodemailer SMTP
  try {
    const transporter = createTransporter();
    if (transporter) {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || '"TWMS Auth" <noreply@textile.com>',
        to: email,
        subject,
        text,
        html,
      });
      console.log('✅ Success: OTP email sent via Nodemailer SMTP.');
      return true;
    }
  } catch (error) {
    console.error('[Email Auth] Nodemailer SMTP failed to send email:', error.message);
  }
  return false;
};

// 1. REGISTER
export const register = async (req, res) => {
  try {
    const { name, email, password, role, department } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password are required' });
    }

    // Check if user exists
    let user = await User.findOne({ where: { email } });
    if (user) {
      if (user.isVerified) {
        return res.status(400).json({ error: 'Email is already registered and verified.' });
      } else {
        // User exists but is unverified - allow registration retry by updating credentials
        const hashedPassword = await bcrypt.hash(password, 10);
        user.name = name;
        user.password = hashedPassword;
        user.role = role || 'Store Operator';
        user.department = department || '';
        await user.save();
      }
    } else {
      // Create new unverified user
      const hashedPassword = await bcrypt.hash(password, 10);
      const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
      user = await User.create({
        name,
        email,
        password: hashedPassword,
        role: role || 'Store Operator',
        department: department || '',
        status: 'Active',
        avatar: initials || 'US',
        isVerified: false,
      });
    }

    // Generate and save OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    user.otpCode = otp;
    user.otpExpires = expires;
    await user.save();

    await sendOtpEmail(email, otp, 'register');

    res.json({
      message: 'Registration initiated. OTP sent to your email.',
      email
    });
  } catch (err) {
    console.error('Registration failed:', err);
    res.status(500).json({ error: 'Registration failed', details: err.message });
  }
};

// 2. VERIFY REGISTER OTP
export const verifyRegisterOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }

    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.isVerified) {
      return res.status(400).json({ error: 'User is already verified' });
    }

    if (user.otpCode !== otp) {
      return res.status(400).json({ error: 'Invalid OTP code' });
    }

    if (new Date() > new Date(user.otpExpires)) {
      return res.status(400).json({ error: 'OTP code has expired' });
    }

    // Mark as verified
    user.isVerified = true;
    user.otpCode = null;
    user.otpExpires = null;
    await user.save();

    // Create JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'super_secret_jwt_key_12345',
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Account verified successfully',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
        avatar: user.avatar,
      },
    });
  } catch (err) {
    console.error('Registration verification failed:', err);
    res.status(500).json({ error: 'Verification failed', details: err.message });
  }
};

// 3. LOGIN
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log(`[LOGIN ATTEMPT] Email: "${email}", Password: "${password}"`);
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    // Handle case where user registered but never verified
    if (!user.isVerified) {
      // Send register OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      user.otpCode = otp;
      user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
      await user.save();
      await sendOtpEmail(email, otp, 'register');
      return res.status(202).json({
        status: 'UNVERIFIED',
        message: 'Your account is unverified. We have sent an OTP to verify your registration.',
        email
      });
    }

    // Generate JWT token immediately
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'super_secret_jwt_key_12345',
      { expiresIn: '24h' }
    );

    // Set lastLogin formatting: YYYY-MM-DD HH:MM
    const now = new Date();
    const pad = (num) => String(num).padStart(2, '0');
    user.lastLogin = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    await user.save();

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
        avatar: user.avatar,
      },
    });
  } catch (err) {
    console.error('Login initialization failed:', err);
    res.status(500).json({ error: 'Login failed', details: err.message });
  }
};

// 4. VERIFY LOGIN OTP
export const verifyLoginOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }

    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.otpCode !== otp) {
      return res.status(400).json({ error: 'Invalid OTP code' });
    }

    if (new Date() > new Date(user.otpExpires)) {
      return res.status(400).json({ error: 'OTP code has expired' });
    }

    // Clean OTP, update lastLogin
    user.otpCode = null;
    user.otpExpires = null;
    
    // Set lastLogin formatting: YYYY-MM-DD HH:MM
    const now = new Date();
    const pad = (num) => String(num).padStart(2, '0');
    user.lastLogin = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    await user.save();

    // Create JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'super_secret_jwt_key_12345',
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
        avatar: user.avatar,
      },
    });
  } catch (err) {
    console.error('Login verification failed:', err);
    res.status(500).json({ error: 'Verification failed', details: err.message });
  }
};

// 5. RESEND OTP
export const resendOtp = async (req, res) => {
  try {
    const { email, type } = req.body;
    if (!email || !type) {
      return res.status(400).json({ error: 'Email and verification type are required' });
    }

    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Generate and save new OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.otpCode = otp;
    user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    await sendOtpEmail(email, otp, type);

    res.json({
      message: 'OTP resent successfully',
      email
    });
  } catch (err) {
    console.error('Resending OTP failed:', err);
    res.status(500).json({ error: 'Resending OTP failed', details: err.message });
  }
};

// 6. FORGOT PASSWORD
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: 'User with this email does not exist' });
    }

    // Generate reset OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.otpCode = otp;
    user.otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 mins
    await user.save();

    // Send email
    await sendOtpEmail(email, otp, 'forgot_password');

    res.json({
      message: 'Password reset OTP has been sent to your email.',
      email
    });
  } catch (err) {
    console.error('Forgot password failed:', err);
    res.status(500).json({ error: 'Forgot password failed', details: err.message });
  }
};

// 7. RESET PASSWORD
export const resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: 'Email, OTP, and new password are required' });
    }

    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.otpCode !== otp) {
      return res.status(400).json({ error: 'Invalid OTP code' });
    }

    if (new Date() > new Date(user.otpExpires)) {
      return res.status(400).json({ error: 'OTP code has expired' });
    }

    // Update password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    user.otpCode = null;
    user.otpExpires = null;
    user.isVerified = true;
    user.status = 'Active';
    await user.save();

    res.json({
      message: 'Password reset successful. You can now log in.'
    });
  } catch (err) {
    console.error('Password reset failed:', err);
    res.status(500).json({ error: 'Password reset failed', details: err.message });
  }
};
