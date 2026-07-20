const mail = require('../server/mail');
mail.enviarCodigoRecuperacion('test@test.com', '123456')
  .then(r => console.log('Result:', r))
  .then(() => {
    console.log('✅ Mail module loaded and executed successfully');
    process.exit(0);
  });
